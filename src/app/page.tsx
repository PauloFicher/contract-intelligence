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
    content: 'Contract Intelligence para Azeta Inmobiliaria. Preguntame sobre clausulas de contratos de alquiler, compraventa y leasing.',
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
    <main className="min-h-screen flex flex-col bg-[#f5f5f7]">
      <header className="sticky top-0 z-10 px-6 py-4 bg-white/70 backdrop-blur-xl border-b border-black/5">
        <h1 className="text-lg font-semibold text-[#1d1d1f] tracking-tight">Contract Intelligence</h1>
        <p className="text-sm text-[#86868b] mt-0.5">Azeta Inmobiliaria &middot; Busqueda semantica de contratos (RAG)</p>
      </header>

      <div className="flex-1 max-w-3xl w-full mx-auto flex flex-col px-4 py-6">
        <div className="flex-1 space-y-4 overflow-y-auto pb-4 max-h-[calc(100vh-10rem)]">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed rounded-2xl ${
                m.role === 'user'
                  ? 'bg-[#0071e3] text-white rounded-br-md'
                  : 'bg-[#f0f0f3] text-[#1d1d1f] rounded-bl-md'
              }`}>
                {m.content}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-black/5 flex flex-wrap gap-1.5">
                    {m.sources.map((s, i) => (
                      <span key={i} className="bg-black/[0.04] rounded-full px-2.5 py-1 text-[11px] text-[#86868b]">
                        <span className="font-medium text-[#6e6e73]">{(s.similarity*100).toFixed(0)}%</span>
                        <span className="mx-1 text-black/10">&middot;</span>
                        <span>{s.clauseType || 'sin tipo'}</span>
                        <span className="mx-1 text-black/10">&middot;</span>
                        <span className="italic">{s.snippet}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#f0f0f3] text-[#86868b] text-sm px-4 py-2.5 rounded-2xl rounded-bl-md">
                Buscando en contratos...
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="bg-white border border-black/5 rounded-2xl p-3 flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Clausula de rescision anticipada en alquileres..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-black/[0.08] bg-white text-[#1d1d1f] text-sm placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-2 bg-[#0071e3] text-white rounded-full text-sm font-medium hover:bg-[#0077ed] disabled:opacity-40 transition-all shrink-0"
          >
            Buscar
          </button>
        </form>
      </div>
    </main>
  );
}
