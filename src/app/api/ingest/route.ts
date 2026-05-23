/**
 * P4 - Contract Intelligence: PDF Ingestion Pipeline
 *
 * POST /api/ingest
 * Body: FormData with { file: PDF, title, contractType, parties, amount }
 *
 * Pipeline:
 * 1. Parsear PDF con pdf-parse
 * 2. Split semantico (no por paginas) con RecursiveCharacterTextSplitter
 * 3. Generar embeddings con OpenAI text-embedding-3-small
 * 4. Insertar en Supabase contract_chunks con embedding vector
 * 5. Insertar metadatos en contracts
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import pdfParse from 'pdf-parse';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const LLM_BASE_URL = LLM_PROVIDER === 'deepseek' ? 'https://api.deepseek.com/v1' : LLM_PROVIDER === 'groq' ? 'https://api.groq.com/openai/v1' : undefined;
const LLM_API_KEY = LLM_PROVIDER === 'deepseek' ? (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY) : LLM_PROVIDER === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL || undefined,
});
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = formData.get('title') as string | null;
    const contractType = formData.get('contractType') as string | null;
    const partiesRaw = formData.get('parties') as string | null;
    const amountRaw = formData.get('amount') as string | null;

    if (!file || !title || !contractType) {
      return NextResponse.json(
        { error: 'Se requiere file, title y contractType.' },
        { status: 400 }
      );
    }

    // 1. Parsear PDF
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdfParse(buffer);
    const fullText = pdfData.text;

    if (!fullText || fullText.trim().length < 50) {
      return NextResponse.json(
        { error: 'El PDF no contiene texto extraible.' },
        { status: 400 }
      );
    }

    // 2. Insertar metadata del contrato
    const parties = partiesRaw ? JSON.parse(partiesRaw) : ['Desconocido'];
    const amount = amountRaw ? parseFloat(amountRaw) : null;

    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .insert({
        title,
        contract_type: contractType,
        parties,
        amount,
        status: 'activo',
      })
      .select()
      .single();

    if (contractError) throw contractError;

    // 3. Chunking semantico con LangChain
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: [
        '\n\nCLAUSULA',
        '\n\nARTICULO',
        '\n\nCAPITULO',
        '\n\nSEGUNDA',
        '\n\nTERCERA',
        '\n\nCUARTA',
        '\n\nQUINTA',
        '\n\n',
        '\n',
        ' ',
      ],
    });

    const chunks = await splitter.createDocuments([fullText]);
    let totalTokens = 0;
    let inserted = 0;

    // 4. Generar embeddings e insertar en lotes de 20
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20);
      const texts = batch.map((c) => c.pageContent);

      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });

      totalTokens += embeddingResponse.usage.total_tokens;

      const rows = embeddingResponse.data.map((emb, idx) => ({
        contract_id: contract.id,
        chunk_index: i + idx,
        content: texts[idx],
        embedding: emb.embedding,
        tokens: embeddingResponse.usage.total_tokens / texts.length,
      }));

      const { error: insertError } = await supabaseAdmin
        .from('contract_chunks')
        .upsert(rows, {
          onConflict: 'contract_id,chunk_index',
        });

      if (insertError) {
        console.error('[ingest] Insert error for batch:', i, insertError);
      } else {
        inserted += rows.length;
      }
    }

    return NextResponse.json({
      success: true,
      contractId: contract.id,
      chunks: inserted,
      totalTokens,
      originalPages: pdfData.numpages,
    });
  } catch (err: any) {
    console.error('[ingest] Error:', err);
    return NextResponse.json(
      { error: 'Error al procesar el PDF.' },
      { status: 500 }
    );
  }
}
