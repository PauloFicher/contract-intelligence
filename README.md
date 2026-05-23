# P4 - Contract Intelligence | Grupo Azeta

## ① Objetivo de negocio

**Problema:** La division inmobiliaria de Azeta gestiona 1,200+ contratos activos (alquiler, compraventa, leasing). Encontrar una clausula especifica toma en promedio 45 minutos de busqueda manual en PDFs.

**Solucion:** Pipeline de ingestion de PDFs que genera embeddings (OpenAI text-embedding-3-small), los almacena en pgvector en Supabase, y permite busqueda por lenguaje natural con respuestas que citan la fuente exacta del contrato.

## ② Arquitectura

```
INGESTION (PDF):
PDF File -> pdf-parse -> texto completo
    -> RecursiveCharacterTextSplitter (LangChain)
        chunkSize: 1000, overlap: 200
        separadores priorizan clausulas: "\n\nCLAUSULA", "\n\nARTICULO"
    -> OpenAI Embeddings (text-embedding-3-small, 1536 dims)
    -> Supabase contract_chunks (pgvector)

QUERY (RAG):
Pregunta usuario
    -> OpenAI Embeddings -> vector query
    -> match_contract_chunks() (cosine similarity)
    -> Top-K chunks recuperados (threshold: 0.7)
    -> System Prompt + contexto -> GPT-4o-mini
    -> Respuesta con citas de fuente
    -> Log en rag_conversations
```

## ③ Por que chunking semantico y no por paginas

**Separadores personalizados:**
```typescript
separators: [
  '\n\nCLAUSULA',   // Prioridad 1: divisiones explicitas de clausulas
  '\n\nARTICULO',   // Prioridad 2: articulos legales
  '\n\nCAPITULO',   // Prioridad 3: capitulos
  '\n\nSEGUNDA',    // Prioridad 4: "SEGUNDA: ..." (estilo notarial paraguayo)
  ...
]
```

- Si dividimos por paginas, una clausula puede cortarse en 2 paginas -> embeddings incompletos.
- LangChain `RecursiveCharacterTextSplitter` prueba separadores en orden, logrando chunks semanticamente completos.
- Overlap de 200 caracteres asegura que no se pierda contexto entre chunks adyacentes.

## ④ Por que pgvector y no Pinecone/Weaviate

- **Supabase ya esta en el stack**: no agregamos un tercer servicio.
- **pgvector es PostgreSQL nativo**: mismo RLS, backups, y queries SQL + vectoriales en una sola DB.
- **HNSW index**: busqueda de similitud coseno en <10ms para 100k+ vectores.
- **Costo**: incluido en el plan de Supabase, sin costo adicional por vector.

## ⑤ Razonamiento del system prompt RAG

El prompt tiene 3 elementos clave:

1. **Restriccion de fuente**: "SOLO responde usando fragmentos proporcionados" -> evita que el LLM invente clausulas o leyes que no existen en los contratos.
2. **Citacion obligatoria**: "Segun [tipo de contrato], Clausula [X]..." -> trazabilidad legal. Un abogado puede verificar la fuente.
3. **Disclaimer legal**: "NO inventes informacion legal ni des consejos legales" -> protege a Azeta de responsabilidad. El sistema es una herramienta de busqueda, no un abogado.

## ⑥ Formato de respuesta

```
{
  "query": "cual es la multa por rescision anticipada en alquileres?",
  "response": "Segun los contratos de alquiler, Clausula DECIMA SEGUNDA: 
              'En caso de rescision anticipada, el inquilino abonara una multa 
              equivalente a dos meses de alquiler...'",
  "sources": [
    { "similarity": 0.94, "clauseType": "rescision", "snippet": "..." }
  ]
}
```

## ⑦ Funcion SQL match_contract_chunks

La funcion en `schema.sql` usa el operador `<=>` de pgvector para distancia coseno:
- `1 - (embedding <=> query_embedding)` convierte distancia a similitud (0-1).
- `match_threshold: 0.7` filtra resultados irrelevantes.
- `filter_contract_id` permite buscar solo en un contrato especifico.

## ⑧ Deploy

```bash
cd P4-contract-intel
pnpm install
cp .env.example .env.local
# En Supabase: ejecutar schema.sql (requiere extension pgvector)
pnpm dev
```

## ⑨ Argumentos de entrevista

**Impacto en Azeta Inmobiliaria:**
- Reduce busqueda de clausulas de 45 min a <5 segundos.
- 1,200 contratos indexados y buscables en lenguaje natural.
- Cada respuesta cita la fuente exacta (trazabilidad legal).
- Escala a cualquier cantidad de contratos sin cambiar codigo.

**Por que RAG y no fine-tuning:**
- Fine-tuning requeriria re-entrenar el modelo cada vez que se agrega un contrato.
- RAG solo requiere regenerar embeddings del nuevo PDF (~$0.00002/contrato en OpenAI).
- RAG permite citar la fuente exacta; fine-tuning "mezcla" el conocimiento sin trazabilidad.

**Stack diferenciador:**
- pgvector en Supabase: cero infraestructura adicional.
- LangChain para chunking semantico con separadores personalizados para contratos legales paraguayos.
- Prompt engineering cuidadoso para evitar alucinaciones legales.
