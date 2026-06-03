import { useRef, useEffect, KeyboardEvent, useState, useCallback } from 'react'
import { Send, Bot, Paperclip, Mic, Loader, Copy, Pencil, RefreshCw, Check, X, Terminal, ChevronDown, ArrowDown, FileText, Image, File, Download } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useAppStore, type Message, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'
import FileEditorPanel from './FileEditorPanel'
import SettingsModal from './SettingsModal'
import { FilePatchCard, type FilePatch } from './FilePatchCard'

interface ChatPanelProps { onOpenTerminal?: (cwd: string) => void; terminalOpen?: boolean }
interface AttachedFile { id: string; name: string; path: string; size: number; content: string; isImage: boolean }

function roleBadgeClass(role?: AgentRole) { return `badge-${role ?? 'fullstack'}` }
function formatTime(ts: number) { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) }
function formatBytes(n: number) { return n < 1024 ? `${n}B` : n < 1048576 ? `${(n/1024).toFixed(1)}KB` : `${(n/1048576).toFixed(1)}MB` }
function cleanTitle(raw: string) {
  return raw.replace(/\*\*/g,'').replace(/\*/g,'').replace(/`/g,'')
    .replace(/#{1,6}\s?/g,'').replace(/[_~]/g,'').replace(/^["'`[\]()]+|["'`[\]()]+$/g,'')
    .replace(/[^\w\s-]/g,' ').replace(/\s+/g,' ').trim()
}
function classifyError(message: string): 'ram' | 'timeout' | 'generic' {
  const m = message.toLowerCase()
  if (m.includes('out of memory')||m.includes('cannot allocate')||m.includes('ggml_')||m.includes('metal')||m.includes('allocation')||m.includes('enomem')||m.includes('memory')||m.includes('resource')) return 'ram'
  if (m.includes('fetch')||m.includes('timeout')||m.includes('abort')||m.includes('network')||m.includes('connect')) return 'timeout'
  return 'generic'
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1').replace(/\*(.+?)\*/gs, '$1')
    .replace(/_{2}(.+?)_{2}/gs, '$1').replace(/_(.+?)_/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/, '').replace(/\n?```$/, ''))
    .replace(/`(.+?)`/g, '$1').replace(/^#{1,6}\s/gm, '').replace(/^[-*]\s/gm, '')
    .replace(/^\d+\.\s/gm, '').replace(/\[(.+?)\]\(.+?\)/g, '$1').replace(/^>\s/gm, '')
    .trim()
}

function extractDisplayContent(content: string): string {
  return content
    .replace(/<file name="[^"]*">[\s\S]*?<\/file>/g, '')
    .replace(/\[Attached image: [^\]]+\]/g, '')
    .replace(/^\n+/, '').trim()
}

function extractFileContent(msgContent: string, fileName: string): string {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<file name="${escaped}">[\\s\\S]*?<\\/file>`)
  const m  = msgContent.match(re)
  return m ? m[0].replace(/<file name="[^"]*">\n?/, '').replace(/\n?<\/file>$/, '') : ''
}

// Parse ```write:path\ncontent\n``` blocks from agent output.
// userPrompt: the user's message that triggered this response (for filename hints in fallback)
function extractPatches(content: string, rootPath?: string, userPrompt?: string): { patches: FilePatch[]; cleanContent: string } {
  const patches: FilePatch[] = []

  // Primary: explicit write: blocks
  const primary = content.replace(/```write:([^\n]+)\n([\s\S]*?)```/g, (_m, fp: string, fc: string) => {
    patches.push({ id: nanoid(), path: fp.trim(), content: fc.trimEnd(), rootPath })
    return `[File proposal: ${fp.trim()}]`
  })
  if (patches.length > 0) return { patches, cleanContent: primary.trim() }

  // Fallback: plain fenced code block — look for filename in agent content OR user prompt
  const searchText = content + ' ' + (userPrompt ?? '')
  const fileNameMatch = searchText.match(/([\w./-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|css|scss|html|json|md|yaml|yml|sh|env|toml|txt|proto|sql|graphql|dockerfile))/i)
  if (fileNameMatch) {
    const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/)
    if (codeMatch) {
      // Clean path: strip leading comment markers and spaces
      const rawPath = fileNameMatch[1].replace(/^\/\/\s*/, '').trim()
      patches.push({ id: nanoid(), path: rawPath, content: codeMatch[1].trimEnd(), rootPath })
      return { patches, cleanContent: content }  // keep original display
    }
  }

  return { patches, cleanContent: primary.trim() }
}

const TEXT_EXTS  = new Set(['ts','tsx','js','jsx','mjs','cjs','vue','svelte','py','rb','go','rs','java','kt','swift','c','cpp','h','cs','php','html','css','scss','sass','less','json','yaml','yml','toml','xml','env','md','mdx','txt','csv','sh','bash','zsh','fish','sql','graphql','proto','dockerfile'])
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','bmp'])
const MAX_FILE_SIZE = 500 * 1024

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return <Image size={12}/>
  if (['ts','tsx','js','jsx'].includes(ext)) return <FileText size={12}/>
  return <File size={12}/>
}

function AttachmentStrip({ files, onRemove }: { files: AttachedFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'6px 0 2px' }}>
      {files.map(f => (
        <div key={f.id} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 8px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, fontSize:11, color:'var(--text-secondary)', maxWidth:180 }}>
          <span style={{ color:'var(--accent)', flexShrink:0 }}>{getFileIcon(f.name)}</span>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }} title={f.name}>{f.name}</span>
          <span style={{ color:'var(--text-muted)', flexShrink:0, fontSize:10 }}>{formatBytes(f.size)}</span>
          <button onClick={() => onRemove(f.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:0, flexShrink:0 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--red)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
          ><X size={11}/></button>
        </div>
      ))}
    </div>
  )
}

function FilePreviewPopup({ name, content, onClose }: { name: string; content: string; onClose: () => void }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:600, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:12, width:'min(700px, 90vw)', maxHeight:'75vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--bg-tertiary)' }}>
          <FileText size={15} style={{ color:'var(--accent)', flexShrink:0 }}/>
          <span style={{ flex:1, fontSize:13, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>{formatBytes(content.length)}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4, borderRadius:4 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
          ><X size={15}/></button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'14px 16px' }}>
          <pre style={{ margin:0, fontSize:12, fontFamily:'monospace', color:'var(--text-primary)', lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{content}</pre>
        </div>
      </div>
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      p:    ({ children }) => <p style={{ margin:'0 0 8px', lineHeight:1.7 }}>{children}</p>,
      h1:   ({ children }) => <h1 style={{ fontSize:16, fontWeight:700, margin:'12px 0 6px' }}>{children}</h1>,
      h2:   ({ children }) => <h2 style={{ fontSize:14, fontWeight:700, margin:'10px 0 5px' }}>{children}</h2>,
      h3:   ({ children }) => <h3 style={{ fontSize:13, fontWeight:600, margin:'8px 0 4px' }}>{children}</h3>,
      ul:   ({ children }) => <ul style={{ margin:'4px 0 8px', paddingLeft:20 }}>{children}</ul>,
      ol:   ({ children }) => <ol style={{ margin:'4px 0 8px', paddingLeft:20 }}>{children}</ol>,
      li:   ({ children }) => <li style={{ margin:'3px 0', lineHeight:1.6 }}>{children}</li>,
      strong: ({ children }) => <strong style={{ color:'var(--text-primary)', fontWeight:600 }}>{children}</strong>,
      em:     ({ children }) => <em style={{ color:'var(--text-secondary)' }}>{children}</em>,
      blockquote: ({ children }) => <blockquote style={{ borderLeft:'3px solid var(--accent)', paddingLeft:12, margin:'6px 0', color:'var(--text-secondary)', fontStyle:'italic' }}>{children}</blockquote>,
      hr:   () => <hr style={{ border:'none', borderTop:'1px solid var(--border)', margin:'10px 0' }}/>,
      a:    ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color:'var(--accent)', textDecoration:'underline' }}>{children}</a>,
      pre:  ({ children }) => <>{children}</>,
      code: ({ children, className }) => {
        const isBlock = !!className?.includes('language-')
        return isBlock
          ? <code style={{ display:'block', background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:6, padding:'10px 14px', fontSize:12, fontFamily:'monospace', overflowX:'auto', margin:'6px 0', lineHeight:1.6, color:'var(--text-primary)' }}>{children}</code>
          : <code style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 5px', fontSize:12, fontFamily:'monospace', color:'var(--accent)' }}>{children}</code>
      },
      table: ({ children }) => <div style={{ overflowX:'auto', margin:'8px 0' }}><table style={{ borderCollapse:'collapse', fontSize:12, width:'100%' }}>{children}</table></div>,
      th:   ({ children }) => <th style={{ border:'1px solid var(--border)', padding:'5px 10px', background:'var(--bg-tertiary)', fontWeight:600, textAlign:'left' }}>{children}</th>,
      td:   ({ children }) => <td style={{ border:'1px solid var(--border)', padding:'5px 10px' }}>{children}</td>,
    }}>{content}</ReactMarkdown>
  )
}

function MsgActions({ content, onEdit, onReload, isUser, visible }: {
  content: string; onEdit?: () => void; onReload?: () => void; isUser: boolean; visible: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard.writeText(stripMarkdown(content)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  const btn: React.CSSProperties = { background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:'3px 4px', borderRadius:4, display:'flex' }
  return (
    <div style={{ display:'flex', gap:2, opacity:visible?1:0, transition:'opacity 0.15s', alignItems:'center', pointerEvents:visible?'auto':'none' }}>
      <button onClick={copy} title="Copy" style={btn}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
      >{copied ? <Check size={12} style={{color:'var(--green)'}}/> : <Copy size={12}/>}</button>
      {isUser && onEdit && <button onClick={onEdit} title="Edit" style={btn}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
      ><Pencil size={12}/></button>}
      {!isUser && onReload && <button onClick={onReload} title="Regenerate" style={btn}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
      ><RefreshCw size={12}/></button>}
    </div>
  )
}

// Agent message with file-patch card support
function AgentBubble({ msg, onReload, rootPath, userPrompt }: { msg: Message; onReload?: () => void; rootPath?: string; userPrompt?: string }) {
  const [hovered,    setHovered]    = useState(false)
  const appliedRef   = useRef<Set<string>>(new Set())
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())

  // Patches derived once from content — stable reference prevents re-creation on every render
  const patchesRef = useRef<FilePatch[] | null>(null)
  if (patchesRef.current === null) {
    patchesRef.current = extractPatches(msg.content, rootPath, userPrompt).patches
  }
  const [patches, setPatches] = useState<FilePatch[]>(patchesRef.current)

  // Re-derive when streaming finalises (type changes stream → agent)
  const prevTypeRef = useRef(msg.type)
  useEffect(() => {
    if (prevTypeRef.current !== 'agent' && msg.type === 'agent') {
      prevTypeRef.current = 'agent'
      const { patches: fresh } = extractPatches(msg.content, rootPath, userPrompt)
      if (fresh.length > 0) setPatches(fresh)
    }
  }, [msg.type]) // eslint-disable-line

  const { cleanContent } = extractPatches(msg.content, rootPath, userPrompt)
  const displayContent = patches.length > 0 ? cleanContent : msg.content

  async function handleApply(patch: FilePatch) {
    if (appliedRef.current.has(patch.id)) return   // guard: already applied — no duplicate writes
    // Resolve full path: absolute paths used as-is; relative paths joined to project root
    const fullPath = patch.path.startsWith('/')
      ? patch.path
      : rootPath
        ? `${rootPath}/${patch.path}`
        : patch.path
    const res = await fetch('http://localhost:3001/project/file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath, content: patch.content }),
    })
    if (!res.ok) throw new Error(`Write failed: ${res.status}`)
    appliedRef.current.add(patch.id)
    setAppliedIds(new Set(appliedRef.current))  // trigger re-render with updated applied set
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:3}}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {msg.agentName && <div className={`agent-badge ${roleBadgeClass(msg.agentRole)}`} style={{display:'inline-block',fontSize:10,alignSelf:'flex-start'}}>{msg.agentName}</div>}
      {displayContent && <div className="msg-agent"><MarkdownContent content={displayContent}/></div>}
      {patches.map(p => (
        <FilePatchCard key={p.id} patch={p}
          alreadyApplied={appliedIds.has(p.id)}
          onApply={handleApply}
          onReject={id => setPatches(ps => ps.filter(x => x.id !== id))}
        />
      ))}
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <span style={{fontSize:10,color:'var(--text-muted)',paddingLeft:2}}>{formatTime(msg.timestamp)}</span>
        <MsgActions content={msg.content} isUser={false} visible={hovered} onReload={onReload}/>
      </div>
    </div>
  )
}

function MessageBubble({ msg, onEdit, onReload, rootPath, userPrompt }: {
  msg: Message; onEdit?: (c: string) => void; onReload?: () => void; rootPath?: string; userPrompt?: string
}) {
  const [hovered,     setHovered]     = useState(false)
  const [previewFile, setPreviewFile] = useState<{ name: string; content: string } | null>(null)
  const cleanDisplay = msg.displayContent ?? extractDisplayContent(msg.content)

  if (msg.type === 'system') {
    const isError = msg.content.startsWith('⚠')
    return (
      <div style={{ display:'flex', justifyContent:'flex-start' }}>
        <div style={{ background:isError?'rgba(239,68,68,0.08)':'var(--bg-tertiary)', border:`1px solid ${isError?'rgba(239,68,68,0.3)':'var(--border)'}`, borderRadius:8, padding:'10px 14px', fontSize:12, color:isError?'var(--red)':'var(--text-muted)', maxWidth:'80%', lineHeight:1.7 }}>
          <MarkdownContent content={msg.content}/>
        </div>
      </div>
    )
  }
  if (msg.type === 'stream') return (
    <div>
      {msg.agentName && <div style={{fontSize:10,color:'var(--accent)',marginBottom:3}}>{msg.agentName}</div>}
      <div className="msg-agent">
        <MarkdownContent content={msg.content}/>
        <span style={{display:'inline-block',width:7,height:13,background:'var(--accent)',marginLeft:2,animation:'blink 1s step-end infinite',verticalAlign:'text-bottom',borderRadius:1}}/>
      </div>
    </div>
  )
  if (msg.type === 'agent') return <AgentBubble msg={msg} onReload={onReload} rootPath={rootPath} userPrompt={userPrompt}/>


  // User bubble
  const time = formatTime(msg.timestamp)
  return (
    <>
      {previewFile && <FilePreviewPopup name={previewFile.name} content={previewFile.content} onClose={() => setPreviewFile(null)}/>}
      <div style={{ display:'flex', justifyContent:'flex-end', width:'100%' }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3, maxWidth:'70%', minWidth:0 }}>
          <MsgActions content={cleanDisplay} isUser visible={hovered} onEdit={() => onEdit?.(cleanDisplay)}/>
          <div className="msg-user">
            {msg.filePaths && msg.filePaths.length > 0 && (
              <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom: cleanDisplay ? 6 : 0 }}>
                {msg.filePaths.map((p: string, i: number) => {
                  const name = p.split('/').pop() ?? p
                  return (
                    <button key={i}
                      onClick={() => setPreviewFile({ name, content: extractFileContent(msg.content, name) || '(No preview)' })}
                      style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, padding:'3px 8px', borderRadius:5, background:'rgba(139,92,246,0.15)', color:'var(--accent)', border:'1px solid rgba(139,92,246,0.3)', cursor:'pointer', fontFamily:'inherit', fontWeight:500 }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.3)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.15)'}
                    ><Paperclip size={10}/>{name}</button>
                  )
                })}
              </div>
            )}
            {cleanDisplay}
          </div>
          <span style={{fontSize:10,color:'var(--text-muted)',paddingRight:2}}>{time}</span>
        </div>
      </div>
    </>
  )
}

function ThinkingBubble() {
  return (
    <div style={{display:'flex',alignItems:'center'}}>
      <div style={{background:'var(--bg-tertiary)',border:'1px solid var(--border)',borderRadius:'3px 12px 12px 12px',padding:'10px 14px',display:'flex',alignItems:'center',gap:8}}>
        <Loader size={13} style={{color:'var(--accent)',animation:'spin 1s linear infinite',flexShrink:0}}/>
        <span style={{fontSize:12,color:'var(--text-muted)'}}>Thinking...</span>
      </div>
    </div>
  )
}

function ModelSelector({ selectedModel, models, activeProvider, cloudModel, isOnline, apiKeyStatus, onOpenSettings, onChange }: {
  selectedModel: string; models: any[]; activeProvider: string; cloudModel: string
  isOnline: boolean; apiKeyStatus: Record<string, boolean>
  onOpenSettings: () => void; onChange: (model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const isCloud     = activeProvider !== 'ollama'
  const displayName = isCloud
    ? `${activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)} · ${(cloudModel || activeProvider).split(':')[0]}`
    : (selectedModel?.split(':')[0] ?? 'No model')
  const COLORS: Record<string,string> = { ollama:'#3dd68c', openai:'#10b981', gemini:'#4285f4', claude:'#d97706', groq:'#8b5cf6', custom:'#94a3b8' }
  const color = COLORS[activeProvider] ?? '#888'
  return (
    <div ref={ref} style={{ position:'relative', flexShrink:0 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:7, background:`${color}15`, border:`1px solid ${color}35`, color, fontSize:11, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap', maxWidth:160, overflow:'hidden' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:120 }}>{displayName}</span>
        <ChevronDown size={10} style={{ flexShrink:0 }}/>
      </button>
      {open && (
        <div style={{ position:'absolute', bottom:'calc(100% + 6px)', left:0, background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:10, padding:6, minWidth:220, maxHeight:300, overflowY:'auto', boxShadow:'0 8px 24px rgba(0,0,0,0.5)', zIndex:100 }}>
          {models.length > 0 && <>
            <div style={{ padding:'4px 8px 2px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Local (Ollama)</div>
            {models.map((m: any) => (
              <button key={m.name} onClick={() => { onChange(m.name); setOpen(false) }}
                style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', background:m.name===selectedModel&&!isCloud?'var(--accent-dim)':'transparent', border:'none', borderRadius:6, cursor:'pointer', textAlign:'left' }}
                onMouseEnter={e => { if (!(m.name===selectedModel&&!isCloud)) (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
                onMouseLeave={e => { if (!(m.name===selectedModel&&!isCloud)) (e.currentTarget as HTMLElement).style.background='transparent' }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:'#3dd68c', flexShrink:0 }}/>
                <span style={{ flex:1, fontSize:12, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.name.split(':')[0]}</span>
                {m.name===selectedModel && !isCloud && <span style={{ fontSize:9, color:'var(--accent)', fontWeight:600 }}>active</span>}
              </button>
            ))}
          </>}
          {isOnline && (() => {
            const CLOUD = [
              { id:'gemini', label:'Gemini Flash', color:'#4285f4' },
              { id:'openai', label:'GPT-4o',       color:'#10b981' },
              { id:'claude', label:'Claude',        color:'#d97706' },
              { id:'groq',   label:'Groq',          color:'#8b5cf6' },
            ] as const
            const available = CLOUD.filter(p => apiKeyStatus[p.id])
            if (!available.length) return null
            return <>
              <div style={{ height:1, background:'var(--border)', margin:'6px 4px' }}/>
              <div style={{ padding:'4px 8px 2px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Cloud</div>
              {available.map(p => (
                <button key={p.id}
                  onClick={async () => {
                    await fetch('http://localhost:3001/settings/provider', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activeProvider: p.id }) })
                    setOpen(false); window.dispatchEvent(new CustomEvent('provider-changed'))
                  }}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', background:isCloud&&activeProvider===p.id?`${p.color}18`:'transparent', border:'none', borderRadius:6, cursor:'pointer', textAlign:'left' }}
                  onMouseEnter={e => { if (!(isCloud&&activeProvider===p.id)) (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
                  onMouseLeave={e => { if (!(isCloud&&activeProvider===p.id)) (e.currentTarget as HTMLElement).style.background='transparent' }}>
                  <div style={{ width:7, height:7, borderRadius:'50%', background:p.color, flexShrink:0 }}/>
                  <span style={{ flex:1, fontSize:12, color:'var(--text-primary)' }}>{p.label}</span>
                  {isCloud && activeProvider===p.id && <span style={{ fontSize:9, color:p.color, fontWeight:600 }}>active</span>}
                </button>
              ))}
            </>
          })()}
          {!isOnline && <div style={{ padding:'7px 10px', fontSize:11, color:'var(--text-muted)', borderTop:'1px solid var(--border)', marginTop:4 }}>Offline - cloud providers unavailable</div>}
          <div style={{ height:1, background:'var(--border)', margin:'6px 4px' }}/>
          <button onClick={() => { setOpen(false); onOpenSettings() }}
            style={{ display:'flex', alignItems:'center', gap:6, width:'100%', padding:'7px 10px', background:'transparent', border:'none', borderRadius:6, cursor:'pointer', color:'var(--text-secondary)', fontSize:12, textAlign:'left' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
            Configure API keys in Settings
          </button>
        </div>
      )}
    </div>
  )
}

export default function ChatPanel({ onOpenTerminal, terminalOpen = false }: ChatPanelProps) {
  const {
    sessions, activeSessionId,
    addMessage, appendStream, finalizeStream,
    selectedModel, models, updateSessionTitle,
    openFiles, activeFile, setActiveFile, closeFile,
    sendingSessionId, streamingSessionId,
    setSendingSession, setStreamingSession,
    isOnline,
  } = useAppStore()

  const [input,          setInput]          = useState('')
  const [attachments,    setAttachments]    = useState<AttachedFile[]>([])
  const [activeProvider, setActiveProvider] = useState('ollama')
  const [cloudModel,     setCloudModel]     = useState('')
  const [apiKeyStatus,   setApiKeyStatus]   = useState<Record<string,boolean>>({})
  const [showSettings,   setShowSettings]   = useState(false)
  const [isAtBottom,     setIsAtBottom]     = useState(true)
  const [toast,          setToast]          = useState<{ msg: string; type: 'info'|'success'|'error' } | null>(null)
  const [mcpConnected,   setMcpConnected]   = useState(false)

  const showToast = useCallback((msg: string, type: 'info'|'success'|'error' = 'info', ms = 3000) => {
    setToast({ msg, type }); setTimeout(() => setToast(null), ms)
  }, [])

  const scrollRef       = useRef<HTMLDivElement>(null)
  const bottomRef       = useRef<HTMLDivElement>(null)
  const textareaRef     = useRef<HTMLTextAreaElement>(null)
  const userScrolledRef = useRef(false)

  const session           = sessions.find(s => s.id === activeSessionId)
  const messages          = session?.messages ?? []
  const isProject         = session?.type === 'project'
  const isChat            = session?.type === 'chat'
  const currentActiveFile = session ? (activeFile[session.id] ?? null) : null
  const isSending         = sendingSessionId   === activeSessionId
  const isStreaming       = streamingSessionId === activeSessionId
  const isBusy            = isSending || isStreaming

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current; if (!el) return
    if (force || !userScrolledRef.current) el.scrollTop = el.scrollHeight
  }, [])
  const handleScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setIsAtBottom(atBottom); userScrolledRef.current = !atBottom
  }, [])
  useEffect(() => { if (!userScrolledRef.current) scrollToBottom() }, [messages.length])
  const lastContent = messages[messages.length - 1]?.content
  useEffect(() => { if (!userScrolledRef.current) scrollToBottom() }, [lastContent])
  useEffect(() => { userScrolledRef.current = false; setIsAtBottom(true); setTimeout(() => scrollToBottom(true), 50) }, [activeSessionId])
  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

  useEffect(() => {
    async function loadProvider() {
      try {
        const res = await fetch('http://localhost:3001/settings')
        const data = await res.json()
        setActiveProvider(data.activeProvider ?? 'ollama')
        setApiKeyStatus(data.apiKeyStatus ?? {})
        if (data.activeProvider !== 'ollama') setCloudModel(data.cloudModels?.[data.activeProvider] ?? '')
      } catch { }
    }
    loadProvider()
    window.addEventListener('provider-changed', loadProvider)
    return () => window.removeEventListener('provider-changed', loadProvider)
  }, [])

  // MCP status poll + auto-connect for project sessions
  useEffect(() => {
    if (!isProject || !session?.rootPath) { setMcpConnected(false); return }
    const rootPath = session.rootPath
    let cancelled = false

    async function checkAndConnect() {
      try {
        const res  = await fetch(`http://localhost:3001/mcp/status?path=${encodeURIComponent(rootPath)}`)
        const data = await res.json()
        if (cancelled) return
        if (data.connected) { setMcpConnected(true); return }
        setMcpConnected(false)
        const conn = await fetch('http://localhost:3001/mcp/connect', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: rootPath }),
        })
        const cd = await conn.json()
        if (!cancelled) setMcpConnected(cd.connected === true)
      } catch { if (!cancelled) setMcpConnected(false) }
    }

    checkAndConnect()
    const interval = setInterval(checkAndConnect, 4000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [activeSessionId, isProject, session?.rootPath]) // eslint-disable-line

  async function handleAttach() {
    try {
      const selected = await open({ multiple: true, filters: [{ name: 'Supported files', extensions: [...TEXT_EXTS, ...IMAGE_EXTS] }] })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      for (const filePath of paths) {
        const name = filePath.split('/').pop() ?? filePath
        const ext  = name.split('.').pop()?.toLowerCase() ?? ''
        if (attachments.find(a => a.path === filePath)) continue
        try {
          if (IMAGE_EXTS.has(ext) || TEXT_EXTS.has(ext)) {
            const res  = await fetch(`http://localhost:3001/project/file?path=${encodeURIComponent(filePath)}`)
            if (!res.ok) continue
            const data = await res.json()
            const raw  = (data.content ?? '') as string
            const content = raw.length > MAX_FILE_SIZE ? raw.slice(0, MAX_FILE_SIZE) + '\n\n[... truncated ...]' : raw
            setAttachments(prev => [...prev, { id: nanoid(), name, path: filePath, size: raw.length, content, isImage: IMAGE_EXTS.has(ext) }])
          }
        } catch { }
      }
    } catch { }
  }

  function buildMessageWithContext(text: string, files: AttachedFile[]): string {
    if (!files.length) return text
    const parts = files.map(f => f.isImage ? `[Attached image: ${f.name}]` : `<file name="${f.name}">\n${f.content}\n</file>`)
    return parts.join('\n\n') + '\n\n' + text
  }

  async function generateTitle(sessionId: string, sessionType: string, rootPath: string | undefined, firstMsg: string) {
    try {
      const res = await fetch('http://localhost:3001/chat/title', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: firstMsg.slice(0, 150) }) })
      if (!res.ok) return
      const data  = await res.json()
      const title = cleanTitle(data.title?.trim() ?? '') || firstMsg.slice(0, 40)
      if (!title || title.toLowerCase() === 'new chat') return
      updateSessionTitle(sessionId, title)
      await api.createSession(sessionId, sessionType, title, rootPath, selectedModel)
    } catch { }
  }

  async function handleModelChange(modelName: string) {
    try {
      await fetch('http://localhost:3001/settings/provider', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activeProvider: 'ollama' }) })
      await api.selectModel(modelName); setActiveProvider('ollama')
    } catch { }
  }

  async function exportChat() {
    if (!session || !messages.length) return
    const lines: string[] = [session.title, `Exported from LocalForge - ${new Date().toLocaleString()}`, '-'.repeat(60), '']
    for (const m of messages) {
      if (m.type === 'user')   lines.push('You:', stripMarkdown(m.displayContent ?? extractDisplayContent(m.content)), '')
      if (m.type === 'agent')  lines.push('AI:', stripMarkdown(m.content), '')
      if (m.type === 'system') lines.push(`[Note: ${stripMarkdown(m.content)}]`, '')
    }
    const text     = lines.join('\n')
    const fileName = session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.txt'
    showToast('Opening save dialog...', 'info')
    try {
      const filePath = await save({ defaultPath: fileName, filters: [{ name: 'Text file', extensions: ['txt'] }] })
      if (!filePath) { setToast(null); return }
      showToast('Saving...', 'info')
      const res = await fetch('http://localhost:3001/project/file', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: filePath, content: text }) })
      if (res.ok) showToast(`Saved - ${filePath.split('/').pop()}`, 'success', 4000)
      else throw new Error(`Server ${res.status}`)
    } catch {
      const blob = new Blob([text], { type:'text/plain' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url)
      showToast(`Downloaded as ${fileName}`, 'success', 3000)
    }
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || !session || isBusy) return
    if (!overrideText) setInput('')
    const sessionId          = session.id
    const sessionType        = session.type
    const rootPath           = session.rootPath
    const isFirstMsg         = messages.filter(m => m.type === 'user').length === 0
    const currentAttachments = [...attachments]
    if (!overrideText) setAttachments([])
    userScrolledRef.current = false; scrollToBottom(true)
    const fullContent    = buildMessageWithContext(text, currentAttachments)
    const filePaths      = currentAttachments.map(f => f.path)
    const msgId = nanoid()
    addMessage(sessionId, { id:msgId, type:'user', content:fullContent, displayContent:text, filePaths, timestamp:Date.now() })
    api.saveMessage(msgId, sessionId, 'user', fullContent).catch(() => {})
    setSendingSession(sessionId); setStreamingSession(null)
    const streamTaskId = nanoid(); let firstChunk = true
    try {
      await api.streamChat(fullContent, sessionId,
        messages.filter(m => m.type==='user'||m.type==='agent').map(m => ({ role:m.type==='user'?'user':'assistant', content:m.content })),
        streamTaskId,
        chunk => {
          if (firstChunk) { setSendingSession(null); setStreamingSession(sessionId); firstChunk=false }
          appendStream(sessionId, streamTaskId, chunk)
        }
      )
      finalizeStream(sessionId, streamTaskId)
      const live = useAppStore.getState().sessions.find(s => s.id === sessionId)
      if (isChat && isFirstMsg && live?.title === 'New chat') generateTitle(sessionId, sessionType, rootPath, text)
    } catch (err: any) {
      const errType = classifyError(err.message)
      const msg = errType === 'ram'
        ? '⚠ **Not enough memory.**\n\n- Close other apps\n- Pull a smaller model: `ollama pull qwen2.5-coder:1.5b`\n- Add a free cloud API key in Settings'
        : errType === 'timeout'
        ? '⚠ **Connection failed.**\n\n- Check the agent server: `cd packages/agent-core && npm run dev`\n- Check Ollama: `ollama serve`'
        : `⚠ **Error:** ${err.message}`
      addMessage(sessionId, { id:nanoid(), type:'system', content:msg, timestamp:Date.now() })
    } finally { setSendingSession(null); setStreamingSession(null) }
  }

  function handleEdit(content: string) { setInput(content); textareaRef.current?.focus() }
  async function handleReload() {
    if (!session || isBusy) return
    const userMsgs = messages.filter(m => m.type==='user')
    if (!userMsgs.length) return
    const last = userMsgs[userMsgs.length-1]
    await send(last.displayContent ?? extractDisplayContent(last.content))
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  const canSend     = !!input.trim() && !!session && !isBusy
  const placeholder = !session ? 'Open a chat or project to start...' : isChat ? 'Ask anything...' : 'Ask about this project...'

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg-primary)' }}>
      <style>{`
        @keyframes spin    { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes blink   { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }
      `}</style>

      {session && (
        <div style={{ flexShrink:0, padding:'0 16px', height:36, borderBottom:'1px solid var(--border)', background:'var(--bg-secondary)', display:'flex', alignItems:'center', gap:8, overflow:'hidden' }}>
          <span style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1, minWidth:0 }}>{session.title}</span>
          {isProject && session.rootPath && <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1, minWidth:0 }}>{session.rootPath}</span>}
          <div style={{ flex:1, minWidth:8 }}/>
          {isProject && (
            <div title={mcpConnected ? 'MCP connected — project files in context' : 'MCP connecting...'}
              style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:8, fontSize:10, fontWeight:600, flexShrink:0, background:mcpConnected?'rgba(61,214,140,0.12)':'rgba(239,68,68,0.10)', border:`1px solid ${mcpConnected?'rgba(61,214,140,0.35)':'rgba(239,68,68,0.3)'}`, color:mcpConnected?'#3dd68c':'var(--red)' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:mcpConnected?'#3dd68c':'var(--red)', boxShadow:mcpConnected?'0 0 5px #3dd68c88':'none', animation:mcpConnected?'none':'blink 1.5s step-end infinite' }}/>
              {mcpConnected ? 'MCP' : 'MCP...'}
            </div>
          )}
          {messages.length > 0 && (
            <button onClick={exportChat}
              style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', background:'transparent', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-secondary)', cursor:'pointer', fontSize:11, flexShrink:0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'; (e.currentTarget as HTMLElement).style.color='var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--border)'; (e.currentTarget as HTMLElement).style.color='var(--text-secondary)' }}
            ><Download size={12}/><span>Export</span></button>
          )}
          {isProject && session.rootPath && onOpenTerminal && (
            <button onClick={() => onOpenTerminal(session.rootPath!)}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px', background:'transparent', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-secondary)', cursor:'pointer', fontSize:12, flexShrink:0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'; (e.currentTarget as HTMLElement).style.color='var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--border)'; (e.currentTarget as HTMLElement).style.color='var(--text-secondary)' }}
            ><Terminal size={13}/><span>Terminal</span></button>
          )}
          <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600, background:'var(--accent-dim)', color:'var(--accent)', flexShrink:0 }}>{session.type}</span>
        </div>
      )}

      {session && isProject && (
        <div style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', flexShrink:0, overflowX:'auto', scrollbarWidth:'none' }}>
          <div onClick={() => setActiveFile(session.id, null)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:4, background:!currentActiveFile?'var(--bg-primary)':'transparent', border:`1px solid ${!currentActiveFile?'var(--border)':'transparent'}`, color:!currentActiveFile?'var(--accent)':'var(--text-secondary)', cursor:'pointer', fontSize:12, fontWeight:500, userSelect:'none', flexShrink:0 }}>
            <Bot size={12}/><span>Chat</span>
          </div>
          {(openFiles[session.id]??[]).map(file => {
            const isActive = currentActiveFile===file
            const name = file.replace(/\\/g,'/').split('/').pop()??'file'
            return (
              <div key={file} onClick={() => setActiveFile(session.id, file)}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px 3px 10px', borderRadius:4, background:isActive?'var(--bg-primary)':'transparent', border:`1px solid ${isActive?'var(--border)':'transparent'}`, color:isActive?'var(--text-primary)':'var(--text-secondary)', cursor:'pointer', fontSize:12, userSelect:'none', flexShrink:0 }}>
                <span>{name}</span>
                <button onClick={e => { e.stopPropagation(); closeFile(session.id, file) }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:1, borderRadius:3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
                ><X size={11}/></button>
              </div>
            )
          })}
        </div>
      )}

      {currentActiveFile ? <FileEditorPanel filePath={currentActiveFile}/> : (
        <>
          <div ref={scrollRef} onScroll={handleScroll}
            style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:14, minHeight:0 }}>
            {messages.length===0 && !isBusy && (
              <div style={{ margin:'auto', textAlign:'center', color:'var(--text-muted)' }}>
                <Bot size={36} style={{ marginBottom:10, opacity:0.3 }}/>
                <div style={{ fontSize:15, fontWeight:500, marginBottom:6, color:'var(--text-secondary)' }}>{isChat ? 'Ask me anything' : 'Project assistant'}</div>
                <div style={{ fontSize:13, lineHeight:1.8, color:'var(--text-muted)' }}>
                  {isChat
                    ? <>Explain concepts, review code, write drafts, answer questions.<br/>Click <Paperclip size={11} style={{display:'inline',verticalAlign:'middle'}}/> to attach files.</>
                    : <>Ask about the codebase, request code changes, or say "write X file" to get an Apply button.<br/>Click <Paperclip size={11} style={{display:'inline',verticalAlign:'middle'}}/> to attach files.</>
                  }
                </div>
              </div>
            )}
            {messages.map((msg, i) => {
              // Find the most recent user message before this one (for fallback filename detection)
              const prevUserMsg = messages.slice(0, i).filter(m => m.type === 'user').pop()
              return (
                <MessageBubble key={msg.id} msg={msg} onEdit={handleEdit}
                  rootPath={session?.rootPath}
                  userPrompt={prevUserMsg?.displayContent ?? prevUserMsg?.content}
                  onReload={i===messages.length-1 && msg.type==='agent' ? handleReload : undefined}
                />
              )
            })}
            {isSending && !isStreaming && <ThinkingBubble/>}
            <div ref={bottomRef} style={{ height:1 }}/>
          </div>

          {!isAtBottom && (
            <div style={{ position:'absolute', bottom: terminalOpen ? 270 : (attachments.length > 0 ? 130 : 100), left:'50%', transform:'translateX(-50%)', zIndex:20 }}>
              <button onClick={() => { userScrolledRef.current=false; scrollToBottom(true) }}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:20, background:'var(--bg-secondary)', border:'1px solid var(--border)', color:'var(--text-primary)', fontSize:12, fontWeight:500, cursor:'pointer', boxShadow:'0 4px 16px rgba(0,0,0,0.4)', backdropFilter:'blur(8px)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'; (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--border)'; (e.currentTarget as HTMLElement).style.background='var(--bg-secondary)' }}
              ><ArrowDown size={13} style={{color:'var(--accent)'}}/> Scroll to bottom</button>
            </div>
          )}

          <div style={{ flexShrink:0, padding:'8px 24px 14px', background:'var(--bg-primary)', position:'relative' }}>
            {attachments.length > 0 && (
              <AttachmentStrip files={attachments} onRemove={id => setAttachments(prev => prev.filter(f => f.id !== id))}/>
            )}
            <div style={{ display:'flex', alignItems:'flex-end', gap:6, background:'var(--bg-tertiary)', border:`1px solid ${isBusy?'var(--accent)':attachments.length?'var(--accent)':'var(--border)'}`, borderRadius:12, padding:'8px 10px 8px 14px', transition:'border-color 0.2s', marginTop:attachments.length?6:0 }}>
              <button onClick={handleAttach} className="icon-btn" title="Attach file"
                style={{ width:28, height:28, flexShrink:0, marginBottom:1, color:attachments.length?'var(--accent)':'var(--text-muted)' }}>
                <Paperclip size={14}/>
              </button>
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown} placeholder={placeholder} disabled={!session||isBusy} rows={1}
                style={{ flex:1, background:'transparent', border:'none', outline:'none', resize:'none', color:'var(--text-primary)', fontSize:13, lineHeight:1.6, fontFamily:'inherit', padding:'2px 0', maxHeight:140, overflowY:'auto' }}
              />
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginBottom:1 }}>
                <ModelSelector selectedModel={selectedModel} models={models} activeProvider={activeProvider} cloudModel={cloudModel} isOnline={isOnline} apiKeyStatus={apiKeyStatus} onOpenSettings={() => setShowSettings(true)} onChange={handleModelChange}/>
                <button className="icon-btn" title="Voice (coming soon)" style={{ width:28, height:28 }}><Mic size={14}/></button>
                <button onClick={() => send()} disabled={!canSend}
                  style={{ width:32, height:32, borderRadius:8, border:'none', background:canSend?'var(--accent)':'var(--bg-hover)', color:canSend?'white':'var(--text-muted)', cursor:canSend?'pointer':'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.15s', flexShrink:0 }}>
                  {isBusy ? <Loader size={13} style={{animation:'spin 1s linear infinite'}}/> : <Send size={13}/>}
                </button>
              </div>
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginTop:5 }}>
              {isBusy ? 'Generating...' : attachments.length ? `${attachments.length} file${attachments.length>1?'s':''} attached - Enter to send` : 'AI can make mistakes. Double-check important responses.'}
            </div>
          </div>
        </>
      )}

      {showSettings && <SettingsModal onClose={() => { setShowSettings(false); window.dispatchEvent(new CustomEvent('provider-changed')) }}/>}

      {toast && (
        <div style={{ position:'fixed', bottom:80, left:'50%', transform:'translateX(-50%)', zIndex:999, pointerEvents:'none', display:'flex', alignItems:'center', gap:8, padding:'10px 18px', borderRadius:10, background:toast.type==='success'?'rgba(16,185,129,0.15)':toast.type==='error'?'rgba(239,68,68,0.15)':'rgba(139,92,246,0.15)', border:`1px solid ${toast.type==='success'?'rgba(16,185,129,0.4)':toast.type==='error'?'rgba(239,68,68,0.4)':'rgba(139,92,246,0.4)'}`, backdropFilter:'blur(12px)', boxShadow:'0 4px 20px rgba(0,0,0,0.4)', fontSize:13, fontWeight:500, color:toast.type==='success'?'var(--green)':toast.type==='error'?'var(--red)':'var(--accent)', whiteSpace:'nowrap', animation:'toastIn 0.2s ease' }}>
          {toast.type==='success' && <Check size={14}/>}
          {toast.type==='error'   && <X size={14}/>}
          {toast.type==='info'    && <Loader size={14} style={{animation:'spin 1s linear infinite'}}/>}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
