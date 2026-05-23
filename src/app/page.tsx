'use client';

import { useState, useRef, useEffect } from 'react';

interface Msg {
  id: string;
  role: 'user' | 'agent';
  content: string;
  sources?: Array<{ similarity: number; clauseType: string; snippet: string }>;
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([{
    id: 'init',
    role: 'agent',
    content: 'Contract Intelligence para Azeta Inmobiliaria. Preguntame sobre clausulas de contratos.',
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Msg = { id: Date.now().toString(), role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg.content }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: data.error || data.response || 'Sin respuesta.',
        sources: data.sources,
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: 'Error de conexion.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-6 min-h-screen flex flex-col">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Contract Intelligence</h1>
        <p className="text-sm text-slate-500">Azeta Inmobiliaria - Busqueda semantica de contratos (RAG)</p>
      </header>

      <div className="flex-1 bg-white rounded-2xl border shadow-sm flex flex-col overflow-hidden">
        <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[60vh]">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-teal-600 text-white rounded-br-md' : 'bg-slate-100 text-slate-800 rounded-bl-md'}`}>
                {m.content}
                {m.sources?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-300/50 space-y-1">
                    {m.sources.map((s, i) => (
                      <p key={i} className="text-[10px] text-slate-500">
                        Fuente {i + 1}: {(s.similarity * 100).toFixed(0)}% match - {s.clauseType || 'sin tipo'} - "{s.snippet}"
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <div className="text-slate-400 text-sm">Buscando en contratos...</div>}
          <div ref={endRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t p-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ej: Clausula de rescision anticipada en alquileres..."
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-30">
            Buscar
          </button>
        </form>
      </div>
    </main>
  );
}
