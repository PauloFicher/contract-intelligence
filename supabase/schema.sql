-- P4 - Contract Intelligence: pgvector schema
-- Requiere extension pgvector. Ejecutar en Supabase Dashboard > SQL Editor.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Contratos (metadatos)
CREATE TABLE IF NOT EXISTS public.contracts (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title           TEXT NOT NULL,
  contract_type   TEXT NOT NULL CHECK (contract_type IN ('alquiler','compraventa','leasing','comodato','otro')),
  parties         TEXT[] NOT NULL,
  amount          NUMERIC(15,2),
  currency        TEXT DEFAULT 'PYG',
  start_date      DATE,
  end_date        DATE,
  status          TEXT DEFAULT 'activo' CHECK (status IN ('activo','finalizado','rescindido','borrador')),
  file_url        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Fragmentos de contrato con embeddings
CREATE TABLE IF NOT EXISTS public.contract_chunks (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id     UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  embedding       extensions.vector(1536),
  clause_type     TEXT,
  tokens          INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(contract_id, chunk_index)
);

-- Indice HNSW para busqueda semantica rapida
-- NOTA: En Supabase, el indice requiere ejecutarse con permisos especiales.
-- Si falla, crear el indice desde el Dashboard en la tabla contract_chunks.
-- CREATE INDEX IF NOT EXISTS idx_contract_chunks_embedding
--   ON public.contract_chunks
--   USING hnsw (embedding extensions.vector_cosine_ops);

-- Conversaciones de busqueda (chat RAG)
CREATE TABLE IF NOT EXISTS public.rag_conversations (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id      TEXT NOT NULL,
  user_query      TEXT NOT NULL,
  retrieved_chunks JSONB,
  llm_response    TEXT NOT NULL,
  tokens_used     INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indices
CREATE INDEX idx_contracts_status    ON public.contracts(status);
CREATE INDEX idx_contracts_type      ON public.contracts(contract_type);
CREATE INDEX idx_chunks_contract     ON public.contract_chunks(contract_id, chunk_index);
CREATE INDEX idx_rag_session         ON public.rag_conversations(session_id, created_at DESC);

-- RLS
ALTER TABLE public.contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_contracts"   ON public.contracts   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_chunks"      ON public.contract_chunks FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_rag"         ON public.rag_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_insert_rag"    ON public.rag_conversations FOR INSERT TO authenticated WITH CHECK (true);

-- Funcion para busqueda por similitud coseno
CREATE OR REPLACE FUNCTION match_contract_chunks(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  filter_contract_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  contract_id uuid,
  content text,
  clause_type text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.contract_id,
    cc.content,
    cc.clause_type,
    1 - (cc.embedding <=> query_embedding) AS similarity
  FROM public.contract_chunks cc
  WHERE
    cc.embedding IS NOT NULL
    AND (filter_contract_id IS NULL OR cc.contract_id = filter_contract_id)
    AND 1 - (cc.embedding <=> query_embedding) > match_threshold
  ORDER BY cc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
