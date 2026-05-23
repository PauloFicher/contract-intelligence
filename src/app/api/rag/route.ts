/**
 * P4 - Contract Intelligence: RAG Query API
 *
 * POST /api/rag
 * Body: { query: string, sessionId: string, topK?: number }
 *
 * Pipeline:
 * 1. Generar embedding de la pregunta del usuario
 * 2. Buscar chunks similares via Supabase pgvector (cosine similarity)
 * 3. Construir prompt con contexto recuperado
 * 4. Generar respuesta con LLM (GPT-4o-mini)
 * 5. Guardar conversacion en rag_conversations
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

const RAG_SYSTEM_PROMPT = `Eres un asistente legal especializado en contratos inmobiliarios de Azeta Inmobiliaria (Paraguay).
Tu funcion es responder preguntas sobre contratos de alquiler, compraventa y leasing basandote UNICAMENTE en los fragmentos de contrato que se te proporcionan.

REGLAS ESTRICTAS:
1. SOLO responde usando la informacion de los fragmentos proporcionados.
2. Si los fragmentos no contienen la respuesta, di: "No encuentro esa clausula en los contratos disponibles."
3. SIEMPRE cita la fuente: "Segun [tipo de contrato], Clausula [X]..."
4. NO inventes informacion legal ni des consejos legales.
5. Responde en espanol, en formato claro y estructurado.
6. Si detectas que la clausula citada es de un tipo de contrato diferente al que pregunta el usuario, aclaralo.

FORMATO DE RESPUESTA:
- Resumen de la clausula encontrada (1-2 oraciones)
- Texto relevante del contrato (entre comillas)
- Tipo de contrato y ubicacion de la clausula`;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.query || body.query.length < 5) {
      return NextResponse.json(
        { error: 'La pregunta debe tener al menos 5 caracteres.' },
        { status: 400 }
      );
    }

    const topK = body.topK || 5;
    const sessionId = body.sessionId || 'default';

    // 1. Embedding de la pregunta
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: body.query,
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;

    // 2. Busqueda vectorial en Supabase
    const { data: chunks, error: searchError } = await supabaseAdmin.rpc(
      'match_contract_chunks',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: topK,
      }
    );

    if (searchError) {
      console.error('[rag] Search error:', searchError);
      return NextResponse.json(
        { error: 'Error en la busqueda semantica. Verifica que pgvector este configurado.' },
        { status: 500 }
      );
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        query: body.query,
        response: 'No encontre clausulas relevantes en los contratos disponibles.',
        sources: [],
      });
    }

    // 3. Construir contexto para el LLM
    const contextText = chunks
      .map(
        (c: any, i: number) =>
          `[FRAGMENTO ${i + 1}] (Similitud: ${(c.similarity * 100).toFixed(1)}%, Clausula: ${c.clause_type || 'No clasificada'})\n${c.content}`
      )
      .join('\n\n---\n\n');

    // 4. Generar respuesta
    const chatResponse = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: RAG_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `CONTEXTO DE CONTRATOS:\n\n${contextText}\n\nPREGUNTA DEL USUARIO: ${body.query}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });

    const llmResponse =
      chatResponse.choices[0].message.content || 'No pude generar una respuesta.';

    // 5. Guardar conversacion (async, no bloquea)
    supabaseAdmin
      .from('rag_conversations')
      .insert({
        session_id: sessionId,
        user_query: body.query,
        retrieved_chunks: chunks.map((c: any) => ({
          id: c.id,
          similarity: c.similarity,
          clause_type: c.clause_type,
        })),
        llm_response: llmResponse,
        tokens_used:
          (chatResponse.usage?.total_tokens || 0) +
          (embeddingResponse.usage?.total_tokens || 0),
      })
      .then(({ error }) => {
        if (error) console.error('[rag] Log error:', error);
      });

    return NextResponse.json({
      query: body.query,
      response: llmResponse,
      sources: chunks.map((c: any) => ({
        similarity: c.similarity,
        clauseType: c.clause_type,
        snippet: c.content.slice(0, 120) + '...',
      })),
    });
  } catch (err: any) {
    console.error('[rag] Error:', err);
    return NextResponse.json(
      { error: 'Error al procesar la consulta RAG.' },
      { status: 500 }
    );
  }
}
