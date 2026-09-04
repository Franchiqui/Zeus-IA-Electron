'use client';

import React from 'react'
import { useState, useRef, useCallback, useEffect     const newImages: { url: string; file: File; ext: string; id: string     const newVideos: { url: string; file: File; ext: string; id: string }[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file) continue
    const newVideos = Array.from<File>(files).map(file => {
      const fullName = file.name || `video.${file.type.split('/')[1] || 'mp4'}`
      const nameWithoutExt = fullName.replace(/\.[^/.]+$/, '')
      const ext = fullName.split('.').pop() || 'mp4'
      newVideos.push({
        url: URL.createObjectURL(file),
        file: file,
        ext: ext,
        id: nameWithoutExt,
      })
    }[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file) continue
    const newImages = Array.from<File>(files).map(file => {
      const fullName = file.name || `image.${file.type.split('/')[1] || 'bin'}`
      const nameWithoutExt = fullName.replace(/\.[^/.]+$/, '')
      const ext = fullName.split('.').pop() || 'bin'
      newImages.push({
        url: URL.createObjectURL(file),
        file: file,
        ext: ext,
        id: nameWithoutExt,
      })
    } from 'react'
import Head from 'next/head'
import { create } from 'zustand'
import { Settings, Download, Send, Code2, ChevronRight, Bold, Italic, Underline, Square, Circle, Wine as LineIcon, Type, Image as ImageIcon, Video as VideoIcon, Trash2, Moon, X, Copy, ClipboardPaste, Undo2, Redo2 } from 'lucide-react'
import JSZip from 'jszip'
import Footer from '@/components/layout/footer'

// ------------------------------------------------------------------
// Types & Store
// ------------------------------------------------------------------

type ModelType = 'vision' | 'text'
type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'custom' | 'local'

interface ModelConfig {
  id: string
  name: string
  type: ModelType
  provider: ModelProvider
  baseUrl: string
  apiKey: string
  modelId: string
}

interface Element {
  id: string
  type: 'rect' | 'circle' | 'line' | 'text' | 'image' | 'video'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  strokeColor: string
  strokeWidth: number
  fillColor: string
  fillOpacity: number
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: string
  textDecoration?: string
  color?: string
  textStrokeColor?: string
  textStrokeWidth?: number
  textShadowColor?: string
  textShadowX?: number
  textShadowY?: number
  textShadowBlur?: number
  textShadow?: string
  src?: string
  opacity: number
  animation?: string | null
  animationDuration?: number
  animationDelay?: number
  localImageId?: string
  imageBorderRadius?: number
  imageBorderWidth?: number
  imageBorderColor?: string
}

const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 960

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AppState {
  models: ModelConfig[]
  setModels: (models: ModelConfig[]) => void
  elements: Element[]
  setElements: (elements: Element[]) => void
  code: string
  setCode: (code: string) => void
  activeTab: 'editor' | 'code'
  setActiveTab: (tab: 'editor' | 'code') => void
  chat: ChatMessage[]
  addChat: (message: ChatMessage) => void
  selectedElementId: string | null
  setSelectedElementId: (id: string | null) => void
  tool: 'select' | 'line' | 'rect' | 'circle' | 'text' | 'image' | 'video'
  setTool: (tool: AppState['tool']) => void
  modelSettingsOpen: boolean
  setModelSettingsOpen: (open: boolean) => void
}

const useStore = create<AppState>((set) => ({
  models: [],
  setModels: (models) => set({ models }),
  elements: [],
  setElements: (elements) => set({ elements }),
  code: '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Tu diseño aparecerá aquí</h1>\n  </body>\n</html>',
  setCode: (code) => set({ code }),
  activeTab: 'editor',
  setActiveTab: (activeTab) => set({ activeTab }),
  chat: [],
  addChat: (message) => set((state) => ({ chat: [...state.chat, message] })),
  selectedElementId: null,
  setSelectedElementId: (id) => set({ selectedElementId: id }),
  tool: 'select',
  setTool: (tool) => set({ tool }),
  modelSettingsOpen: false,
  setModelSettingsOpen: (open) => set({ modelSettingsOpen: open }),
}))



// ------------------------------------------------------------------
// Helpers: Code generation from elements
// ------------------------------------------------------------------

function generateHtml(elements: Element[], useLocalImagePaths = false, localImages?: { url: string; file: File; ext: string; id: string }[], canvasBackground?: string, canvasWidth = CANVAS_WIDTH, canvasHeight = CANVAS_HEIGHT, canvasEffect = 'none', particleCount = 60, particleColor = '#ffffff', particleShape = 'circle', particleSpeed = 1, particleSize = 1, starCount = 80, starSpeed = 1, starSize = 1, starColor = '#ffffff', gradientSpeed = 15, customParticleImage?: { url: string; file: File; ext: string; id: string } | null): string {
  const styles: string[] = []
  const body: string[] = []
  const googleFonts = new Set<string>()
  const systemFonts = new Set(['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana'])
  const animatedIds = new Set<string>()

  let contentWidth = canvasWidth
  let contentHeight = canvasHeight

  elements.forEach((el) => {
    const id = `el-${el.id}`
    const css: string[] = [
      `position: absolute`,
      `left: ${el.x}px`,
      `top: ${el.y}px`,
      `width: ${el.width}px`,
      `height: ${el.height}px`,
      `opacity: ${el.opacity}`,
      `transform: rotate(${el.rotation}deg)`,
    ]

    if (el.type === 'rect') {
      css.push(
        `background-color: ${hexToRgba(el.fillColor, el.fillOpacity)}`,
        `border: ${el.strokeWidth}px solid ${el.strokeColor}`,
        `border-radius: 4px`
      )
      body.push(`<div id="${id}" style="${css.join('; ')}"></div>`)
    } else if (el.type === 'circle') {
      css.push(
        `background-color: ${hexToRgba(el.fillColor, el.fillOpacity)}`,
        `border: ${el.strokeWidth}px solid ${el.strokeColor}`,
        `border-radius: 50%`
      )
      body.push(`<div id="${id}" style="${css.join('; ')}"></div>`)
    } else if (el.type === 'line') {
      const angle = Math.atan2(el.height, el.width)
      const len = Math.hypot(el.width, el.height)
      css.push(
        `width: ${len}px`,
        `height: ${el.strokeWidth}px`,
        `background-color: ${el.strokeColor}`,
        `transform-origin: center`,
        `transform: rotate(${(angle * 180) / Math.PI}deg)`
      )
      body.push(`<div id="${id}" style="${css.join('; ')}"></div>`)
    } else if (el.type === 'text') {
      const fontFamily = el.fontFamily || 'Arial'
      if (!systemFonts.has(fontFamily.replace(/['"]/g, ''))) {
        googleFonts.add(fontFamily.replace(/['"]/g, ''))
      }
      css.push(
        `font-family: ${fontFamily}`,
        `font-size: ${el.fontSize}px`,
        `font-weight: ${el.fontWeight}`,
        `font-style: ${el.fontStyle}`,
        `text-decoration: ${el.textDecoration}`,
        `color: ${el.color}`,
        `text-align: center`,
        `width: ${el.width}px`
      )
      if (el.textStrokeColor && el.textStrokeWidth) {
        css.push(`-webkit-text-stroke: ${el.textStrokeWidth}px ${el.textStrokeColor}`)
        css.push(`text-stroke: ${el.textStrokeWidth}px ${el.textStrokeColor}`)
      }
      if (el.textShadowColor || el.textShadowX != null || el.textShadowY != null || el.textShadowBlur != null) {
        css.push(`text-shadow: ${el.textShadowX ?? 0}px ${el.textShadowY ?? 0}px ${el.textShadowBlur ?? 0}px ${el.textShadowColor || '#000000'}`)
      } else if (el.textShadow) {
        css.push(`text-shadow: ${el.textShadow}`)
      }
      body.push(`<div id="${id}" style="${css.join('; ')}">${el.text}</div>`)
    } else if (el.type === 'image' && el.src) {
      let src = el.src
      if (useLocalImagePaths) {
        const localImage = localImages?.find(img => img.url === el.src)
        const ext = localImage?.ext || 'jpg'
        src = `./images/${el.id}.${ext}`
      }
      if (el.imageBorderRadius) css.push(`border-radius: ${el.imageBorderRadius}px`)
      if (el.imageBorderWidth) css.push(`border: ${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}`)
      body.push(`<img id="${id}" src="${src}" style="${css.join('; ')}" onerror="this.style.border='2px solid red';this.title='Error loading image: '+this.src;" />`)
    } else if (el.type === 'video' && el.src) {
      let src = el.src
      if (useLocalImagePaths) {
        const localVideo = localImages?.find(img => img.url === el.src)
        const ext = localVideo?.ext || 'mp4'
        src = `./videos/${el.id}.${ext}`
      }
      if (el.imageBorderRadius) css.push(`border-radius: ${el.imageBorderRadius}px`)
      if (el.imageBorderWidth) css.push(`border: ${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}`)
      body.push(`<video id="${id}" src="${src}" style="${css.join('; ')}" controls></video>`)
    }

    if (el.type !== 'image' && el.type !== 'video') {
      styles.push(`#${id} { position: absolute; }`)
    }

    if (el.animation) {
      animatedIds.add(id)
      const duration = el.animationDuration || 1
      const delay = el.animationDelay || 0
      styles.push(`#${id} { animation: ${el.animation} ${duration}s ${delay}s both; }`)
    }

    const elRight = el.x + Math.max(el.width, 0)
    const elBottom = el.y + Math.max(el.height, 0)
    if (elRight > contentWidth) contentWidth = elRight
    if (elBottom > contentHeight) contentHeight = elBottom
  })

  const googleFontsLink = googleFonts.size > 0
    ? `@import url('https://fonts.googleapis.com/css2?family=${Array.from(googleFonts).map(f => f.replace(/ /g, '+')).join('&family=')}');`
    : ''

  const animationKeyframes = animatedIds.size > 0 ? getAnimationKeyframes() : ''
  const canvasEffectCode = getCanvasEffectCode(canvasEffect, canvasWidth, canvasHeight, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, customParticleImage, useLocalImagePaths)
  const animatedBackground = canvasEffect === 'gradient-animated'
    ? (canvasBackground?.startsWith('linear-gradient') ? canvasBackground : `linear-gradient(-45deg, ${canvasBackground || 'white'}, ${canvasBackground || 'white'}, #1e3a8a, #3b82f6)`)
    : canvasBackground
  const bodyBackgroundStyle = canvasEffect === 'gradient-animated'
    ? `background: ${animatedBackground}; background-size: 400% 400%; animation: gradientShift ${gradientSpeed}s ease infinite;`
    : `background: ${canvasBackground || 'white'};`

  return `<!DOCTYPE html>
<html>
<head>
<style>
  ${googleFontsLink}
  ${animationKeyframes}
  ${canvasEffectCode.css}
  html {
    min-height: 100%;
    overflow: auto;
  }
  body {
    width: ${contentWidth}px;
    min-height: ${canvasEffect === 'gradient-animated' ? '100vh' : contentHeight + 'px'};
    ${bodyBackgroundStyle}
    position: relative;
    margin: 0 auto;
    overflow: visible;
  }
  ${styles.join('\n')}
</style>
</head>
<body>
${body.join('\n')}
${canvasEffectCode.html}
${canvasEffectCode.script}
</body>
</html>`
}

function getCanvasEffectCode(effect: string, width: number, height: number, particleCount = 60, particleColor = '#ffffff', particleShape = 'circle', particleSpeed = 1, particleSize = 1, starCount = 80, starSpeed = 1, starSize = 1, starColor = '#ffffff', gradientSpeed = 15, customParticleImage?: { url: string; file: File; ext: string; id: string } | null, useLocalImagePaths = false): { css: string; html: string; script: string } {
  if (effect === 'gradient-animated') {
    return {
      css: `@keyframes gradientShift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }`,
      html: '',
      script: '',
    }
  }

  if (effect === 'particles' || effect === 'stars') {
    const particleImageUrl = effect === 'particles' && customParticleImage
      ? (useLocalImagePaths ? `./images/${customParticleImage.id}.${customParticleImage.ext}` : customParticleImage.url)
      : undefined
    return {
      css: `#effect-canvas {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 0;
      }`,
      html: `<canvas id="effect-canvas"></canvas>`,
      script: effect === 'particles' ? getParticlesScript(particleCount, particleColor, particleShape, particleSpeed, particleSize, particleImageUrl) : getStarsScript(particleCount, starSpeed, starSize, starColor),
    }
  }

  return { css: '', html: '', script: '' }
}

function getParticlesScript(particleCount = 60, particleColor = '#ffffff', particleShape = 'circle', particleSpeed = 1, particleSize = 1, customParticleImageUrl?: string): string {
  const rgb = hexToRgb(particleColor) || '255,255,255'
  const baseRadius = Math.max(0.5, particleSize) * 3
  const imagePreload = customParticleImageUrl
    ? `const particleImg = new Image(); particleImg.src = '${customParticleImageUrl}';`
    : 'const particleImg = null;'
  return `<script>
    (function() {
      ${imagePreload}
      const canvas = document.getElementById('effect-canvas')
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      let width = window.innerWidth
      let height = window.innerHeight
      canvas.width = width
      canvas.height = height
      const particles = []
      const count = ${particleCount}
      const speed = ${particleSpeed}
      const baseR = ${baseRadius.toFixed(2)}
      const shape = '${particleShape}'
      for (let i = 0; i < count; i++) {
        const r = Math.max(0.5, baseR * (0.5 + Math.random()))
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: r,
          dx: (Math.random() - 0.5) * 0.8 * speed,
          dy: (Math.random() - 0.5) * 0.8 * speed,
          opacity: Math.random() * 0.5 + 0.2,
        })
      }
      function draw() {
        ctx.clearRect(0, 0, width, height)
        particles.forEach((p) => {
          ctx.globalAlpha = p.opacity
          if (particleImg && particleImg.complete) {
            const size = p.radius * 2
            ctx.drawImage(particleImg, p.x - size / 2, p.y - size / 2, size, size)
          } else {
            ctx.beginPath()
            if (shape === 'square') {
              ctx.rect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2)
            } else if (shape === 'triangle') {
              ctx.moveTo(p.x, p.y - p.radius)
              ctx.lineTo(p.x + p.radius, p.y + p.radius)
              ctx.lineTo(p.x - p.radius, p.y + p.radius)
              ctx.closePath()
            } else {
              ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
            }
            ctx.fillStyle = 'rgba(${rgb},' + p.opacity + ')'
            ctx.fill()
          }
          ctx.globalAlpha = 1
          p.x += p.dx
          p.y += p.dy
          if (p.x < 0) p.x = width
          if (p.x > width) p.x = 0
          if (p.y < 0) p.y = height
          if (p.y > height) p.y = 0
        })
        requestAnimationFrame(draw)
      }
      draw()
      window.addEventListener('resize', () => {
        width = window.innerWidth
        height = window.innerHeight
        canvas.width = width
        canvas.height = height
      })
    })()
  <\/script>`
}

function getStarsScript(particleCount = 80, starSpeed = 1, starSize = 1, starColor = '#ffffff'): string {
  const rgb = hexToRgb(starColor) || '255,255,255'
  return `<script>
    (function() {
      const canvas = document.getElementById('effect-canvas')
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      let width = window.innerWidth
      let height = window.innerHeight
      canvas.width = width
      canvas.height = height
      const stars = []
      const count = ${particleCount}
      const speed = ${starSpeed}
      const size = ${starSize}
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.5 + 0.5,
          alpha: Math.random(),
          speed: (Math.random() * 0.02 + 0.005) * speed,
        })
      }
      function draw() {
        ctx.clearRect(0, 0, width, height)
        stars.forEach((s) => {
          s.alpha += s.speed
          if (s.alpha > 1 || s.alpha < 0.1) s.speed = -s.speed
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(${rgb},' + Math.abs(s.alpha) + ')'
          ctx.fill()
        })
        requestAnimationFrame(draw)
      }
      draw()
      window.addEventListener('resize', () => {
        width = window.innerWidth
        height = window.innerHeight
        canvas.width = width
        canvas.height = height
      })
    })()
  <\/script>`
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function hexToRgb(hex: string): string | null {
  const h = hex.replace('#', '')
  if (h.length !== 6) return null
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r},${g},${b}`
}

function getAnimationKeyframes(): string {
  return `@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes slideInLeft {
    from { opacity: 0; transform: translateX(-100%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(100%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideInUp {
    from { opacity: 0; transform: translateY(100%); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideInDown {
    from { opacity: 0; transform: translateY(-100%); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes bounceIn {
    0% { opacity: 0; transform: scale(0.3); }
    50% { opacity: 1; transform: scale(1.05); }
    70% { transform: scale(0.9); }
    100% { transform: scale(1); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.1); opacity: 0.8; }
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
  }
  @keyframes zoomIn {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes flipInX {
    from { opacity: 0; transform: perspective(400px) rotateX(90deg); }
    to { opacity: 1; transform: perspective(400px) rotateX(0); }
  }`
}

// ------------------------------------------------------------------
// ZIP helpers
// ------------------------------------------------------------------

async function downloadZip(files: { name: string; content: Uint8Array }[]) {
  const zip = new JSZip()
  files.forEach((file) => {
    zip.file(file.name, file.content)
  })
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'design.zip'
  a.click()
  URL.revokeObjectURL(url)
}

// ------------------------------------------------------------------
// Model API call (simplified)
// ------------------------------------------------------------------

async function callModel(model: ModelConfig | undefined, prompt: string, imageBase64?: string): Promise<string> {
  if (!model) throw new Error('No hay modelo configurado')

  const baseUrl = model.baseUrl || 'https://api.openai.com/v1'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${model.apiKey}`,
  }

  const body: Record<string, unknown> = {
    model: model.modelId,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...(imageBase64
            ? [{ type: 'image_url', image_url: { url: imageBase64 } }]
            : []),
        ],
      },
    ],
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`API error: ${res.statusText}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  } catch (error) {
    console.error(error)
    return `[Error al llamar al modelo ${model.name}]`
  }
}

// ------------------------------------------------------------------
// Page Component
// ------------------------------------------------------------------

export default function Page() {
  const {
    models,
    setModels,
    elements,
    setElements,
    code,
    setCode,
    activeTab,
    setActiveTab,
    chat,
    addChat,
    selectedElementId,
    setSelectedElementId,
    tool,
    setTool,
    modelSettingsOpen,
    setModelSettingsOpen,
  } = useStore()

  const [fontFamily, setFontFamily] = useState('Arial')
  const [customFont, setCustomFont] = useState('')
  const [fontSize, setFontSize] = useState(20)
  const [fontColor, setFontColor] = useState('#000000')
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [fillColor, setFillColor] = useState('#ffffff')
  const [fillOpacity, setFillOpacity] = useState(1)
  const [imageTransparency, setImageTransparency] = useState(1)
  const [imageBorderRadius, setImageBorderRadius] = useState(0)
  const [imageBorderWidth, setImageBorderWidth] = useState(0)
  const [imageBorderColor, setImageBorderColor] = useState('#000000')
  const [chatInput, setChatInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [localImages, setLocalImages] = useState<{ url: string; file: File; ext: string; id: string }[]>([])
  const [canvasColorType, setCanvasColorType] = useState<'solid' | 'gradient'>('solid')
  const [canvasColor, setCanvasColor] = useState('#ffffff')
  const [canvasGradientStart, setCanvasGradientStart] = useState('#ffffff')
  const [canvasGradientEnd, setCanvasGradientEnd] = useState('#000000')
  const [canvasGradientDirection, setCanvasGradientDirection] = useState(180)
  const [canvasWidth, setCanvasWidth] = useState(CANVAS_WIDTH)
  const [canvasHeight, setCanvasHeight] = useState(CANVAS_HEIGHT)
  const [canvasEffect, setCanvasEffect] = useState<string>('none')
  const [clipboard, setClipboard] = useState<Element[] | null>(null)
  const [history, setHistory] = useState<Element[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const isUndoRedoRef = useRef(false)
  const [animation, setAnimation] = useState<string>('')
  const [animationDuration, setAnimationDuration] = useState<number>(1)
  const [animationDelay, setAnimationDelay] = useState<number>(0)
  const [particleCount, setParticleCount] = useState<number>(60)
  const [particleColor, setParticleColor] = useState<string>('#ffffff')
  const [particleShape, setParticleShape] = useState<string>('circle')
  const [particleSpeed, setParticleSpeed] = useState<number>(1)
  const [particleSize, setParticleSize] = useState<number>(1)
  const [customParticleImage, setCustomParticleImage] = useState<{ url: string; file: File; ext: string; id: string } | null>(null)
  const [starCount, setStarCount] = useState<number>(80)
  const [starSpeed, setStarSpeed] = useState<number>(1)
  const [starSize, setStarSize] = useState<number>(1)
  const [starColor, setStarColor] = useState<string>('#ffffff')
  const [gradientSpeed, setGradientSpeed] = useState<number>(15)

  const handleDeleteElement = useCallback(() => {
    if (!selectedElementId) return
    setElements(elements.filter((el) => el.id !== selectedElementId))
    setSelectedElementId(null)
  }, [elements, selectedElementId, setElements, setSelectedElementId])

  const pushHistory = useCallback((newElements: Element[]) => {
    if (isUndoRedoRef.current) return
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(newElements)))
      if (newHistory.length > 50) newHistory.shift()
      setHistoryIndex(newHistory.length - 1)
      return newHistory
    })
  }, [historyIndex])

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return
    isUndoRedoRef.current = true
    const prevElements = history[historyIndex - 1]
    setElements(JSON.parse(JSON.stringify(prevElements)))
    setHistoryIndex(historyIndex - 1)
    setTimeout(() => {
      isUndoRedoRef.current = false
    }, 0)
  }, [history, historyIndex])

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    isUndoRedoRef.current = true
    const nextElements = history[historyIndex + 1]
    setElements(JSON.parse(JSON.stringify(nextElements)))
    setHistoryIndex(historyIndex + 1)
    setTimeout(() => {
      isUndoRedoRef.current = false
    }, 0)
  }, [history, historyIndex])

  const handleCopy = useCallback(() => {
    if (!selectedElementId) return
    const el = elements.find((e) => e.id === selectedElementId)
    if (el) setClipboard([el])
  }, [elements, selectedElementId])

  const handlePaste = useCallback(() => {
    if (!clipboard || clipboard.length === 0) return
    const newElements = clipboard.map((el) => ({
      ...el,
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      x: el.x + 20,
      y: el.y + 20,
    }))
    const updated = [...elements, ...newElements]
    pushHistory(updated)
    setElements(updated)
    setSelectedElementId(newElements[0].id)
  }, [clipboard, elements, pushHistory])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const mod = isMac ? e.metaKey : e.ctrlKey

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((mod && e.shiftKey && e.key === 'z') || (mod && e.key === 'y')) {
        e.preventDefault()
        handleRedo()
      } else if (mod && e.key === 'c') {
        e.preventDefault()
        handleCopy()
      } else if (mod && e.key === 'v') {
        e.preventDefault()
        handlePaste()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId && document.activeElement === document.body) {
          e.preventDefault()
          handleDeleteElement()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo, handleCopy, handlePaste, selectedElementId, handleDeleteElement])

  const selectedElement = elements.find((el) => el.id === selectedElementId) || null

  useEffect(() => {
    if (selectedElement) {
      setAnimation(selectedElement.animation || '')
      setAnimationDuration(selectedElement.animationDuration || 1)
      setAnimationDelay(selectedElement.animationDelay || 0)
    }
  }, [selectedElementId])

  useEffect(() => {
    if (history.length === 0) {
      setHistory([JSON.parse(JSON.stringify(elements))])
      setHistoryIndex(0)
    }
  }, [])

  useEffect(() => {
    if (isUndoRedoRef.current) return
    pushHistory(elements)
  }, [elements, pushHistory])

  useEffect(() => {
    const background = canvasColorType === 'solid' ? canvasColor : `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
    const html = generateHtml(elements, false, undefined, background, canvasWidth, canvasHeight, canvasEffect, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, customParticleImage)
    setCode(html)
  }, [elements, setCode, canvasColorType, canvasColor, canvasGradientDirection, canvasGradientStart, canvasGradientEnd, canvasWidth, canvasHeight, canvasEffect])

  useEffect(() => {
    if (!customFont) return
    const linkId = 'google-font-link'
    const existing = document.getElementById(linkId)
    if (existing) existing.remove()
    const link = document.createElement('link')
    link.id = linkId
    link.href = `https://fonts.googleapis.com/css2?family=${customFont.replace(/ /g, '+')}`
    link.rel = 'stylesheet'
    document.head.appendChild(link)
    return () => {
      const node = document.getElementById(linkId)
      if (node) node.remove()
    }
  }, [customFont])

  const handleDownloadZip = async () => {
    const background = canvasColorType === 'solid' ? canvasColor : `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
    const html = generateHtml(elements, true, localImages, background, canvasWidth, canvasHeight, canvasEffect, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, customParticleImage)
    const files: { name: string; content: Uint8Array }[] = [
      { name: 'index.html', content: new TextEncoder().encode(html) },
    ]

    const imageElements = elements.filter((el): el is Element & { src: string } => (el.type === 'image' || el.type === 'video') && !!el.src)

    for (const el of imageElements) {
      const localImage = localImages.find(img => img.url === el.src)
      if (localImage) {
        const arrayBuffer = await localImage.file.arrayBuffer()
        const mediaFolder = el.type === 'video' ? 'videos' : 'images'
        files.push({ name: `${mediaFolder}/${el.id}.${localImage.ext}`, content: new Uint8Array(arrayBuffer) })
      } else if (el.src.startsWith('http')) {
        try {
          const response = await fetch(el.src)
          const blob = await response.blob()
          const arrayBuffer = await blob.arrayBuffer()
          const ext = blob.type.split('/')[1]?.split(';')[0] || (el.type === 'video' ? 'mp4' : 'jpg')
          const mediaFolder = el.type === 'video' ? 'videos' : 'images'
          files.push({ name: `${mediaFolder}/${el.id}.${ext}`, content: new Uint8Array(arrayBuffer) })
        } catch (error) {
          console.error('Error downloading image:', error)
        }
      }
    }

    if (customParticleImage) {
      const arrayBuffer = await customParticleImage.file.arrayBuffer()
      files.push({ name: `images/${customParticleImage.id}.${customParticleImage.ext}`, content: new Uint8Array(arrayBuffer) })
    }

    await downloadZip(files)
  }

  const handleSaveProject = () => {
    const saveImages = async () => {
      const savedImages = await Promise.all(
        localImages.map(async (img) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(img.file)
          })
          return {
            id: img.id,
            ext: img.ext,
            base64,
          }
        })
      )
      const savedParticleImage = customParticleImage
        ? await new Promise<{ id: string; ext: string; base64: string }>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => {
              resolve({
                id: customParticleImage.id,
                ext: customParticleImage.ext,
                base64: reader.result as string,
              })
            }
            reader.readAsDataURL(customParticleImage.file)
          })
        : null
      const project = {
        elements: elements.map((el) => {
          if ((el.type === 'image' || el.type === 'video') && el.src) {
            const localImage = localImages.find((img) => img.url === el.src)
            if (localImage) {
              return { ...el, localImageId: localImage.id }
            }
          }
          return el
        }),
        canvasColorType,
        canvasColor,
        canvasGradientStart,
        canvasGradientEnd,
        canvasGradientDirection,
        canvasWidth,
        canvasHeight,
        customFont,
        canvasEffect,
        particleCount,
        particleColor,
        particleShape,
        particleSpeed,
        particleSize,
        starCount,
        starSpeed,
        starSize,
        starColor,
        gradientSpeed,
        customParticleImage: savedParticleImage,
        images: savedImages,
      }
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'proyecto.json'
      a.click()
      URL.revokeObjectURL(url)
    }
    saveImages()
  }

  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const project = JSON.parse(event.target?.result as string)
        if (project.canvasColorType) setCanvasColorType(project.canvasColorType)
        if (project.canvasColor) setCanvasColor(project.canvasColor)
        if (project.canvasGradientStart) setCanvasGradientStart(project.canvasGradientStart)
        if (project.canvasGradientEnd) setCanvasGradientEnd(project.canvasGradientEnd)
        if (project.canvasGradientDirection) setCanvasGradientDirection(project.canvasGradientDirection)
        if (project.canvasWidth) setCanvasWidth(project.canvasWidth)
        if (project.canvasHeight) setCanvasHeight(project.canvasHeight)
        if (project.canvasEffect) setCanvasEffect(project.canvasEffect)
        if (project.particleCount) setParticleCount(project.particleCount)
        if (project.particleColor) setParticleColor(project.particleColor)
        if (project.particleShape) setParticleShape(project.particleShape)
        if (project.particleSpeed) setParticleSpeed(project.particleSpeed)
        if (project.particleSize) setParticleSize(project.particleSize)
        if (project.starCount) setStarCount(project.starCount)
        if (project.starSpeed) setStarSpeed(project.starSpeed)
        if (project.starSize) setStarSize(project.starSize)
        if (project.starColor) setStarColor(project.starColor)
        if (project.gradientSpeed) setGradientSpeed(project.gradientSpeed)
        if (project.customFont) {
          setCustomFont(project.customFont)
          setFontFamily(`'${project.customFont}'`)
        }
        let restoredImages: { url: string; file: File; ext: string; id: string }[] = []
        if (project.images) {
          restoredImages = project.images.map((img: { id: string; ext: string; base64: string }) => {
            const base64Data = img.base64.split(',')[1]
            const byteCharacters = atob(base64Data)
            const byteNumbers = new Array(byteCharacters.length)
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i)
            }
            const byteArray = new Uint8Array(byteNumbers)
            const blob = new Blob([byteArray])
            const url = URL.createObjectURL(blob)
            const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(img.ext)
            const file = new File([blob], `${img.id}.${img.ext}`, { type: `${isVideo ? 'video' : 'image'}/${img.ext}` })
            return {
              id: img.id,
              ext: img.ext,
              url,
              file,
            }
          })
          setLocalImages(restoredImages)
        }

        if (project.customParticleImage) {
          const base64Data = project.customParticleImage.base64.split(',')[1]
          const byteCharacters = atob(base64Data)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const blob = new Blob([byteArray])
          const url = URL.createObjectURL(blob)
          const file = new File([blob], `${project.customParticleImage.id}.${project.customParticleImage.ext}`, { type: `image/${project.customParticleImage.ext}` })
          setCustomParticleImage({
            id: project.customParticleImage.id,
            ext: project.customParticleImage.ext,
            url,
            file,
          })
        }

        if (project.elements) {
          const restoredElements = project.elements.map((el: Element & { localImageId?: string }) => {
            if ((el.type !== 'image' && el.type !== 'video') || !el.src) return el
            const restoredImage = el.localImageId
              ? restoredImages.find((img) => img.id === el.localImageId)
              : restoredImages.find((img) => img.id === el.id)
            if (restoredImage) {
              return {
                ...el,
                src: restoredImage.url,
              }
            }
            return el
          })
          console.log('Restored elements:', restoredElements)
          console.log('Restored images:', restoredImages)
          setElements(restoredElements)
        }
      } catch (error) {
        console.error('Error loading project:', error)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleSendChat = async () => {
    if (!chatInput.trim()) return
    addChat({ role: 'user', content: chatInput })
    const textModel = models.find((m) => m.type === 'text')
    const visionModel = models.find((m) => m.type === 'vision')
    setChatInput('')

    if (textModel) {
      setIsGenerating(true)
      const visionSnapshot = visionModel ? 'data:image/png;base64,PLACEHOLDER' : undefined
      const prompt = `Eres un experto en HTML. El usuario ha dibujado un diseño. Responde su pregunta o mejora el código:\n\n${code}\n\nPregunta: ${chatInput}`
      const response = await callModel(textModel, prompt, visionSnapshot)
      addChat({ role: 'assistant', content: response })
      setIsGenerating(false)
    } else {
      addChat({
        role: 'assistant',
        content: 'Configura un modelo de texto en los ajustes para obtener respuestas reales. Por ahora, esta es una respuesta simulada.',
      })
    }
  }

  return (
import React from 'react';

export default function Page() {
  return (
    import React from 'react';

export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Editor HTML</h1>
      <p>La página está en reconstrucción. Consulta los respaldos en el panel de archivos.</p>
    </main>
  );
}
      {/* Editor en reconstrucción - se restaurará desde page.tsx.zeus-backup */}
    </>
  );
}
  )
}

// ------------------------------------------------------------------
// Editor Component
// ------------------------------------------------------------------

interface EditorProps {
  elements: Element[]
  setElements: (elements: Element[]) => void
  selectedElementId: string | null
  setSelectedElementId: (id: string | null) => void
  tool: AppState['tool']
  setTool: (tool: AppState['tool']) => void
  fontFamily: string
  setFontFamily: React.Dispatch<React.SetStateAction<string>>
  customFont: string
  setCustomFont: React.Dispatch<React.SetStateAction<string>>
  fontSize: number
  setFontSize: React.Dispatch<React.SetStateAction<number>>
  fontColor: string
  setFontColor: React.Dispatch<React.SetStateAction<string>>
  isBold: boolean
  setIsBold: React.Dispatch<React.SetStateAction<boolean>>
  isItalic: boolean
  setIsItalic: React.Dispatch<React.SetStateAction<boolean>>
  isUnderline: boolean
  setIsUnderline: React.Dispatch<React.SetStateAction<boolean>>
  strokeColor: string
  setStrokeColor: React.Dispatch<React.SetStateAction<string>>
  strokeWidth: number
  setStrokeWidth: React.Dispatch<React.SetStateAction<number>>
  fillColor: string
  setFillColor: React.Dispatch<React.SetStateAction<string>>
  fillOpacity: number
  setFillOpacity: React.Dispatch<React.SetStateAction<number>>
  imageTransparency: number
  setImageTransparency: React.Dispatch<React.SetStateAction<number>>
  imageBorderRadius: number
  setImageBorderRadius: React.Dispatch<React.SetStateAction<number>>
  imageBorderWidth: number
  setImageBorderWidth: React.Dispatch<React.SetStateAction<number>>
  imageBorderColor: string
  setImageBorderColor: React.Dispatch<React.SetStateAction<string>>
  selectedElement: Element | null
  onDelete: () => void
  localImages: { url: string; file: File; ext: string; id: string }[]
  setLocalImages: React.Dispatch<React.SetStateAction<{ url: string; file: File; ext: string; id: string }[]>>
  canvasColorType: 'solid' | 'gradient'
  setCanvasColorType: React.Dispatch<React.SetStateAction<'solid' | 'gradient'>>
  canvasColor: string
  setCanvasColor: React.Dispatch<React.SetStateAction<string>>
  canvasGradientStart: string
  setCanvasGradientStart: React.Dispatch<React.SetStateAction<string>>
  canvasGradientEnd: string
  setCanvasGradientEnd: React.Dispatch<React.SetStateAction<string>>
  canvasGradientDirection: number
  setCanvasGradientDirection: React.Dispatch<React.SetStateAction<number>>
  canvasWidth: number
  setCanvasWidth: React.Dispatch<React.SetStateAction<number>>
  canvasHeight: number
  setCanvasHeight: React.Dispatch<React.SetStateAction<number>>
  canvasEffect: string
  setCanvasEffect: React.Dispatch<React.SetStateAction<string>>
  particleCount: number
  setParticleCount: React.Dispatch<React.SetStateAction<number>>
  particleColor: string
  setParticleColor: React.Dispatch<React.SetStateAction<string>>
  particleShape: string
  setParticleShape: React.Dispatch<React.SetStateAction<string>>
  particleSpeed: number
  setParticleSpeed: React.Dispatch<React.SetStateAction<number>>
  particleSize: number
  setParticleSize: React.Dispatch<React.SetStateAction<number>>
  customParticleImage: { url: string; file: File; ext: string; id: string } | null
  setCustomParticleImage: React.Dispatch<React.SetStateAction<{ url: string; file: File; ext: string; id: string } | null>>
  starCount: number
  setStarCount: React.Dispatch<React.SetStateAction<number>>
  starSpeed: number
  setStarSpeed: React.Dispatch<React.SetStateAction<number>>
  starSize: number
  setStarSize: React.Dispatch<React.SetStateAction<number>>
  starColor: string
  setStarColor: React.Dispatch<React.SetStateAction<string>>
  gradientSpeed: number
  setGradientSpeed: React.Dispatch<React.SetStateAction<number>>
  clipboard: Element[] | null
  setClipboard: React.Dispatch<React.SetStateAction<Element[] | null>>
  history: Element[][]
  historyIndex: number
  onCopy: () => void
  onPaste: () => void
  onUndo: () => void
  onRedo: () => void
  animation: string
  setAnimation: React.Dispatch<React.SetStateAction<string>>
  animationDuration: number
  setAnimationDuration: React.Dispatch<React.SetStateAction<number>>
  animationDelay: number
  setAnimationDelay: React.Dispatch<React.SetStateAction<number>>
}

function Editor({
  elements,
  setElements,
  selectedElementId,
  setSelectedElementId,
  tool,
  setTool,
  fontFamily,
  setFontFamily,
  customFont,
  setCustomFont,
  fontSize,
  setFontSize,
  fontColor,
  setFontColor,
  isBold,
  setIsBold,
  isItalic,
  setIsItalic,
  isUnderline,
  setIsUnderline,
  strokeColor,
  setStrokeColor,
  strokeWidth,
  setStrokeWidth,
  fillColor,
  setFillColor,
  fillOpacity,
  setFillOpacity,
  imageTransparency,
  setImageTransparency,
  imageBorderRadius,
  setImageBorderRadius,
  imageBorderWidth,
  setImageBorderWidth,
  imageBorderColor,
  setImageBorderColor,
  selectedElement,
  onDelete,
  localImages,
  setLocalImages,
  canvasColorType,
  setCanvasColorType,
  canvasColor,
  setCanvasColor,
  canvasGradientStart,
  setCanvasGradientStart,
  canvasGradientEnd,
  setCanvasGradientEnd,
  canvasGradientDirection,
  setCanvasGradientDirection,
  canvasWidth,
  setCanvasWidth,
  canvasHeight,
  setCanvasHeight,
  canvasEffect,
  setCanvasEffect,
  particleCount,
  setParticleCount,
  particleColor,
  setParticleColor,
  particleShape,
  setParticleShape,
  particleSpeed,
  setParticleSpeed,
  particleSize,
  setParticleSize,
  customParticleImage,
  setCustomParticleImage,
  starCount,
  setStarCount,
  starSpeed,
  setStarSpeed,
  starSize,
  setStarSize,
  starColor,
  setStarColor,
  gradientSpeed,
  setGradientSpeed,
  clipboard,
  setClipboard,
  history,
  historyIndex,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  animation,
  setAnimation,
  animationDuration,
  setAnimationDuration,
  animationDelay,
  setAnimationDelay,
}: EditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{
    type: 'move' | 'create'
    elementId?: string
    startX: number
    startY: number
    originalX?: number
    originalY?: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const handleSelectImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: FileList | null = e.target.files
    if (!files) return
    const newImages: { url: string; file: File; ext: string; id: string }[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i) as File | null
      if (!file) continue
      const fullName = file.name || `image.${file.type.split('/')[1] || 'bin'}`
      const nameWithoutExt = fullName.replace(/\.[^/.]+$/, '')
      const ext = fullName.split('.').pop() || 'bin'
      newImages.push({
        url: URL.createObjectURL(file),
        file: file,
        ext: ext,
        id: nameWithoutExt,
      })
    }
    setLocalImages(prev => [...prev, ...newImages])
    e.target.value = ''
  }

  const handleSelectVideos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: FileList | null = e.target.files
    if (!files) return
    const newVideos: { url: string; file: File; ext: string; id: string }[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i) as File | null
      if (!file) continue
      const fullName = file.name || `video.${file.type.split('/')[1] || 'mp4'}`
      const nameWithoutExt = fullName.replace(/\.[^/.]+$/, '')
      const ext = fullName.split('.').pop() || 'mp4'
      newVideos.push({
        url: URL.createObjectURL(file),
        file: file,
        ext: ext,
        id: nameWithoutExt,
      })
    }
    setLocalImages(prev => [...prev, ...newVideos])
    e.target.value = ''
  }

  const getMousePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e)
    if (tool === 'select') {
      const reversed = [...elements].reverse()
      const el = reversed.find((el) => {
        const x = el.x
        const y = el.y
        const w = el.width
        const h = el.height
        return pos.x >= x && pos.x <= x + Math.abs(w) && pos.y >= y && pos.y <= y + Math.abs(h)
      })
      if (el) {
        setSelectedElementId(el.id)
        setDragState({ type: 'move', elementId: el.id, startX: pos.x, startY: pos.y, originalX: el.x, originalY: el.y })
      } else {
        setSelectedElementId(null)
      }
      return
    }

    const newId = `el-${Date.now()}`
    let newElement: Element | undefined

    if (tool === 'line') {
      newElement = {
        id: newId,
        type: 'line',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: 0,
        strokeColor,
        strokeWidth,
        fillColor: 'transparent',
        fillOpacity: 0,
        opacity: 1,
        animation: null,
        animationDuration: 1,
        animationDelay: 0,
      }
    } else if (tool === 'rect') {
      newElement = {
        id: newId,
        type: 'rect',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: 0,
        strokeColor,
        strokeWidth,
        fillColor,
        fillOpacity,
        opacity: 1,
        animation: null,
        animationDuration: 1,
        animationDelay: 0,
      }
    } else if (tool === 'circle') {
      newElement = {
        id: newId,
        type: 'circle',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: 0,
        strokeColor,
        strokeWidth,
        fillColor,
        fillOpacity,
        opacity: 1,
        animation: null,
        animationDuration: 1,
        animationDelay: 0,
      }
    } else if (tool === 'text') {
      newElement = {
        id: newId,
        type: 'text',
        x: pos.x,
        y: pos.y,
        width: 200,
        height: fontSize + 10,
        rotation: 0,
        strokeColor: 'transparent',
        strokeWidth: 0,
        fillColor: 'transparent',
        fillOpacity: 0,
        text: 'Texto',
        fontFamily,
        fontSize,
        fontWeight: isBold ? 700 : 400,
        fontStyle: isItalic ? 'italic' : 'normal',
        textDecoration: isUnderline ? 'underline' : 'none',
        color: fontColor,
        opacity: 1,
        animation: null,
        animationDuration: 1,
        animationDelay: 0,
      }
    } else if (tool === 'image' && localImages.length) {
      const localImage = localImages[Math.floor(Math.random() * localImages.length)]
      const imageUrl = localImage.url
      newElement = {
        id: newId,
        type: 'image',
        x: pos.x,
        y: pos.y,
        width: 200,
        height: 140,
        rotation: 0,
        strokeColor: 'transparent',
        strokeWidth: 0,
        fillColor: 'transparent',
        fillOpacity: 0,
        src: imageUrl,
        opacity: imageTransparency,
        animation: null,
        animationDuration: 1,
        animationDelay: 0,
        localImageId: localImage.id,
        imageBorderRadius: 0,
        imageBorderWidth: 0,
        imageBorderColor: '#000000',
      }
    } else if (tool === 'video' && localImages.length) {
      const localVideo = localImages[Math.floor(Math.random() * localImages.length)]
      const videoUrl = localVideo.url
      newElement = {
        id: newId,
        type: 'video',
        x: pos.x,
        y: pos.y,
        width: 320,
        height: 180,
        rotation: 0,
        strokeColor: 'transparent',
        strokeWidth: 0,
        fillColor: 'transparent',
        fillOpacity: 0,
        src: videoUrl,
        opacity: imageTransparency,
        animation: null,
        animationDuration: 1,
        animationDelay: 0,
        localImageId: localVideo.id,
        imageBorderRadius: 0,
        imageBorderWidth: 0,
        imageBorderColor: '#000000',
      }
    }

    if (newElement) {
      const finalId = newElement.id || newId
      setElements([...elements, { ...newElement, id: finalId }])
      setSelectedElementId(finalId)
      setDragState({ type: 'create', elementId: finalId, startX: pos.x, startY: pos.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState) return
    const pos = getMousePos(e)
    const dx = pos.x - dragState.startX
    const dy = pos.y - dragState.startY

    const updated = elements.map((el) => {
      if (el.id !== dragState.elementId) return el
      if (dragState.type === 'move') {
        return {
          ...el,
          x: (dragState.originalX ?? 0) + dx,
          y: (dragState.originalY ?? 0) + dy,
        }
      } else {
        if (el.type === 'line') {
          return { ...el, width: dx, height: dy }
        } else if (el.type === 'circle' || el.type === 'rect') {
          return { ...el, width: dx, height: dy }
        }
        return el
      }
    })
    setElements(updated)
  }

  const handleMouseUp = () => {
    setDragState(null)
  }

  const getCanvasBackground = () => {
    if (canvasColorType === 'solid') {
      return canvasColor
    }
    return `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
  }

  const handleUpdateSelected = (patch: Partial<Element>) => {
    if (!selectedElement) return
    setElements(elements.map((el) => (el.id === selectedElement.id ? { ...el, ...patch } : el)))
  }

  const handleUpdateAnimation = (patch: { animation?: string | null; animationDuration?: number; animationDelay?: number }) => {
    if (!selectedElement) return
    setElements(elements.map((el) => (el.id === selectedElement.id ? { ...el, ...patch } : el)))
  }

  return (
      <div className="flex w-full gap-4 flex-col lg:flex-row">
      <div className="w-full lg:w-96 shrink-0 space-y-4">
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Lienzo</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Ancho</span>
              <input
                type="number"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(Number(e.target.value))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Alto</span>
              <input
                type="number"
                value={canvasHeight}
                onChange={(e) => setCanvasHeight(Number(e.target.value))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={canvasColorType}
                onChange={(e) => setCanvasColorType(e.target.value as 'solid' | 'gradient')}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              >
                <option value="solid">Color sólido</option>
                <option value="gradient">Degradado</option>
              </select>
            </div>
            {canvasColorType === 'solid' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Color</span>
                <input
                  type="color"
                  value={canvasColor}
                  onChange={(e) => setCanvasColor(e.target.value)}
                  className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                />
                <input
                  type="text"
                  value={canvasColor}
                  onChange={(e) => setCanvasColor(e.target.value)}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Inicio</span>
                  <input
                    type="color"
                    value={canvasGradientStart}
                    onChange={(e) => setCanvasGradientStart(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={canvasGradientStart}
                    onChange={(e) => setCanvasGradientStart(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Fin</span>
                  <input
                    type="color"
                    value={canvasGradientEnd}
                    onChange={(e) => setCanvasGradientEnd(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={canvasGradientEnd}
                    onChange={(e) => setCanvasGradientEnd(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Ángulo</span>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={canvasGradientDirection}
                    onChange={(e) => setCanvasGradientDirection(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">{canvasGradientDirection}°</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Efecto</span>
              <select
                value={canvasEffect}
                onChange={(e) => setCanvasEffect(e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              >
                <option value="none">Ninguno</option>
                <option value="particles">Partículas</option>
                <option value="stars">Estrellas</option>
                <option value="gradient-animated">Degradado animado</option>
              </select>
            </div>
            {canvasEffect === 'particles' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Cantidad</span>
                  <input
                    type="number"
                    min="0"
                    max="300"
                    value={particleCount}
                    onChange={(e) => setParticleCount(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Color</span>
                  <input
                    type="color"
                    value={particleColor}
                    onChange={(e) => setParticleColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={particleColor}
                    onChange={(e) => setParticleColor(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Forma</span>
                  <select
                    value={particleShape}
                    onChange={(e) => setParticleShape(e.target.value)}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  >
                    <option value="circle">Círculo</option>
                    <option value="square">Cuadrado</option>
                    <option value="triangle">Triángulo</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Tamaño</span>
                  <input
                    type="number"
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={particleSize}
                    onChange={(e) => setParticleSize(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Imagen</span>
                  <input
                    type="file"
                    accept="image/png,image/webp,image/gif,image/svg+xml,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const url = URL.createObjectURL(file)
                      const ext = file.name.split('.').pop() || 'png'
                      setCustomParticleImage({ url, file, ext, id: `particle-img-${Date.now()}` })
                    }}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                  {customParticleImage && (
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(customParticleImage.url)
                        setCustomParticleImage(null)
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Velocidad</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={particleSpeed}
                    onChange={(e) => setParticleSpeed(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            )}
            {canvasEffect === 'stars' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Cantidad</span>
                  <input
                    type="number"
                    min="0"
                    max="300"
                    value={starCount}
                    onChange={(e) => setStarCount(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Color</span>
                  <input
                    type="color"
                    value={starColor}
                    onChange={(e) => setStarColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={starColor}
                    onChange={(e) => setStarColor(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Tamaño</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={starSize}
                    onChange={(e) => setStarSize(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Velocidad</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={starSpeed}
                    onChange={(e) => setStarSpeed(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            )}
            {canvasEffect === 'gradient-animated' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">Velocidad</span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    step="1"
                    value={gradientSpeed}
                    onChange={(e) => setGradientSpeed(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-gray-400">s</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Texto</h3>
          <div className="space-y-2">
            <select
              value={fontFamily}
              onChange={(e) => {
                setFontFamily(e.target.value)
                if (selectedElement?.type === 'text') handleUpdateSelected({ fontFamily: e.target.value })
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
            >
              {['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Fuente Google Fonts (ej: Roboto)"
                value={customFont}
                onChange={(e) => setCustomFont(e.target.value)}
                className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
              <button
                onClick={() => {
                  if (!customFont.trim()) return
                  setFontFamily(`'${customFont.trim()}'`)
                  if (selectedElement?.type === 'text') {
                    handleUpdateSelected({ fontFamily: `'${customFont.trim()}'` })
                  }
                }}
                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                Aplicar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={fontSize}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setFontSize(v)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ fontSize: v, height: v + 10 })
                }}
                className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
              <input
                type="color"
                value={fontColor}
                onChange={(e) => {
                  setFontColor(e.target.value)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ color: e.target.value })
                }}
                className="h-8 w-8 cursor-pointer rounded-md border border-gray-700 bg-gray-900"
              />
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setIsBold(!isBold)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ fontWeight: !isBold ? 700 : 400 })
                }}
                className={`rounded-md p-2 ${isBold ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
              >
                <Bold className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setIsItalic(!isItalic)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ fontStyle: !isItalic ? 'italic' : 'normal' })
                }}
                className={`rounded-md p-2 ${isItalic ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
              >
                <Italic className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setIsUnderline(!isUnderline)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ textDecoration: !isUnderline ? 'underline' : 'none' })
                }}
                className={`rounded-md p-2 ${isUnderline ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
              >
                <Underline className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Dibujo</h3>
          <div className="flex gap-2 mb-2">
            <button
              onClick={onCopy}
              disabled={!selectedElementId}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              Copiar
            </button>
            <button
              onClick={onPaste}
              disabled={!clipboard}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <ClipboardPaste className="h-4 w-4" />
              Pegar
            </button>
            <button
              onClick={onUndo}
              disabled={historyIndex <= 0}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              Deshacer
            </button>
            <button
              onClick={onRedo}
              disabled={historyIndex >= history.length - 1}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <Redo2 className="h-4 w-4" />
              Rehacer
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={<ChevronRight className="h-4 w-4" />} label="Seleccionar" />
            <ToolButton active={tool === 'line'} onClick={() => setTool('line')} icon={<LineIcon className="h-4 w-4" />} label="Línea" />
            <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} icon={<Square className="h-4 w-4" />} label="Cuadrado" />
            <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} icon={<Circle className="h-4 w-4" />} label="Círculo" />
            <ToolButton active={tool === 'text'} onClick={() => setTool('text')} icon={<Type className="h-4 w-4" />} label="Texto" />
            <ToolButton active={tool === 'image'} onClick={() => setTool('image')} icon={<ImageIcon className="h-4 w-4" />} label="Imagen" />
            <ToolButton active={tool === 'video'} onClick={() => setTool('video')} icon={<VideoIcon className="h-4 w-4" />} label="Vídeo" />
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Trazo</span>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => {
                  setStrokeColor(e.target.value)
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle' || selectedElement.type === 'line'))
                    handleUpdateSelected({ strokeColor: e.target.value })
                }}
                className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
              />
              <input
                type="number"
                value={strokeWidth}
                onChange={(e) => {
                  setStrokeWidth(Number(e.target.value))
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle' || selectedElement.type === 'line'))
                    handleUpdateSelected({ strokeWidth: Number(e.target.value) })
                }}
                className="w-16 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Relleno</span>
              <input
                type="color"
                value={fillColor}
                onChange={(e) => {
                  setFillColor(e.target.value)
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle'))
                    handleUpdateSelected({ fillColor: e.target.value })
                }}
                className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={fillOpacity}
                onChange={(e) => {
                  setFillOpacity(Number(e.target.value))
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle'))
                    handleUpdateSelected({ fillOpacity: Number(e.target.value) })
                }}
                className="flex-1"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Insertar Imagen</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleSelectImages}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-400 transition hover:border-blue-500 hover:text-blue-400"
          >
            <ImageIcon className="h-4 w-4" />
            Seleccionar imagen
          </button>
          {localImages.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {localImages.map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const newId = item.id || `img-${Date.now()}`
                    setElements([
                      ...elements,
                      {
                        id: newId,
                        type: 'image',
                        x: Math.random() * 200 + 50,
                        y: Math.random() * 200 + 50,
                        width: 160,
                        height: 110,
                        rotation: 0,
                        strokeColor: 'transparent',
                        strokeWidth: 0,
                        fillColor: 'transparent',
                        fillOpacity: 0,
                        src: item.url,
                        opacity: 1,
                      },
                    ])
                  }}
                  className="overflow-hidden rounded-md border border-gray-700"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" className="h-12 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Insertar Vídeo</h3>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleSelectVideos}
            className="hidden"
          />
          <button
            onClick={() => videoInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-400 transition hover:border-blue-500 hover:text-blue-400"
          >
            <VideoIcon className="h-4 w-4" />
            Seleccionar vídeo
          </button>
          {localImages.filter(item => ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(item.ext)).length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2">
              {localImages.filter(item => ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(item.ext)).map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const newId = item.id || `video-${Date.now()}`
                    setElements([
                      ...elements,
                      {
                        id: newId,
                        type: 'video',
                        x: Math.random() * 200 + 50,
                        y: Math.random() * 200 + 50,
                        width: 320,
                        height: 180,
                        rotation: 0,
                        strokeColor: 'transparent',
                        strokeWidth: 0,
                        fillColor: 'transparent',
                        fillOpacity: 0,
                        src: item.url,
                        opacity: 1,
                      },
                    ])
                  }}
                  className="overflow-hidden rounded-md border border-gray-700"
                >
                  <video src={item.url} className="h-20 w-full object-cover" muted playsInline />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center overflow-auto p-4">
        <div
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="relative overflow-hidden rounded-xl border border-gray-800 shadow-2xl"
          style={{ width: canvasWidth, height: canvasHeight, background: getCanvasBackground() }}
        >
        {elements.map((el) => (
          <div
            key={el.id}
            className={`absolute cursor-move ${
              selectedElementId === el.id ? 'ring-2 ring-blue-500' : ''
            }`}
            style={{
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              transform: `rotate(${el.rotation}deg)`,
              opacity: el.opacity,
              pointerEvents: tool === 'select' ? 'auto' : 'none',
            }}
            onMouseDown={(e) => {
              if (tool !== 'select') return
              e.stopPropagation()
              const pos = getMousePos(e)
              setSelectedElementId(el.id)
              setDragState({ type: 'move', elementId: el.id, startX: pos.x, startY: pos.y, originalX: el.x, originalY: el.y })
            }}
          >
            {el.type === 'rect' && (
              <div
                className="h-full w-full rounded"
                style={{
                  backgroundColor: el.fillColor,
                  opacity: el.fillOpacity,
                  border: `${el.strokeWidth}px solid ${el.strokeColor}`,
                }}
              />
            )}
            {el.type === 'circle' && (
              <div
                className="h-full w-full rounded-full"
                style={{
                  backgroundColor: el.fillColor,
                  opacity: el.fillOpacity,
                  border: `${el.strokeWidth}px solid ${el.strokeColor}`,
                }}
              />
            )}
            {el.type === 'line' && (
              <div
                className="h-full w-full"
                style={{
                  backgroundColor: el.strokeColor,
                  height: el.strokeWidth,
                  transform: `rotate(${Math.atan2(el.height, el.width)}rad)`,
                  transformOrigin: 'top left',
                  width: Math.hypot(el.width, el.height),
                  opacity: el.opacity,
                }}
              />
            )}
            {el.type === 'text' && (
              <div
                className="whitespace-pre-wrap"
                style={{
                  fontFamily: el.fontFamily,
                  fontSize: el.fontSize,
                  fontWeight: el.fontWeight,
                  fontStyle: el.fontStyle,
                  textDecoration: el.textDecoration,
                  color: el.color,
                  textAlign: 'center',
                  width: '100%',
                  opacity: el.opacity,
                  ...(el.textStrokeColor && el.textStrokeWidth ? {
                    WebkitTextStroke: `${el.textStrokeWidth}px ${el.textStrokeColor}`,
                    textStroke: `${el.textStrokeWidth}px ${el.textStrokeColor}`,
                  } : {}),
                  ...(el.textShadowColor || el.textShadowX != null || el.textShadowY != null || el.textShadowBlur != null ? {
                    textShadow: `${el.textShadowX ?? 0}px ${el.textShadowY ?? 0}px ${el.textShadowBlur ?? 0}px ${el.textShadowColor || '#000000'}`,
                  } : el.textShadow ? {
                    textShadow: el.textShadow,
                  } : {}),
                }}
              >
                {el.text}
              </div>
            )}
            {el.type === 'image' && el.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={el.src}
                alt=""
                className="h-full w-full object-cover"
                style={{
                  borderRadius: el.imageBorderRadius ? `${el.imageBorderRadius}px` : undefined,
                  border: el.imageBorderWidth ? `${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}` : undefined,
                }}
                draggable={false}
              />
            )}
            {el.type === 'video' && el.src && (
              <video
                src={el.src}
                className="h-full w-full object-cover"
                style={{
                  borderRadius: el.imageBorderRadius ? `${el.imageBorderRadius}px` : undefined,
                  border: el.imageBorderWidth ? `${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}` : undefined,
                }}
                controls
                draggable={false}
              />
            )}
            {selectedElementId === el.id && (
              import React from 'react';

export default function Page() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Editor HTML</h1>
      <p>La página está en reconstrucción. Consulta respaldos en el panel de archivos.</p>
    </main>
  );
}
                <div
                  className="absolute bottom-1 right-1 h-3 w-3 cursor-se-resize rounded-sm bg-blue-500"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    const startX = e.clientX
                    const startY = e.clientY
                    const origW = el.width
                    const origH = el.height
                    const onMouseMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX
                      const dy = ev.clientY - startY
                      handleUpdateSelected({ width: origW + dx, height: origH + dy })
                    }
                    const onMouseUp = () => {
                      window.removeEventListener('mousemove', onMouseMove)
                      window.removeEventListener('mouseup', onMouseUp)
                    }
                    window.addEventListener('mousemove', onMouseMove)
                    window.addEventListener('mouseup', onMouseUp)
                  }}
                />
                <button
                  onClick={onDelete}
                  className="absolute right-1 top-1 rounded bg-red-600 p-0.5 text-white"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ))}

        {elements.length === 0 && (
          <div className="flex h-full items-center justify-center text-gray-400">
            Selecciona una herramienta y dibuja en el lienzo
          </div>
        )}
        </div>
      </div>

      <div className="w-full lg:w-72 shrink-0 space-y-4">
        {selectedElement ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Propiedades</h3>
            {(selectedElement.type === 'image' || selectedElement.type === 'video') && (
              <>
                <div className="space-y-2">
                  <label className="block text-xs text-gray-500">Ancho</label>
                  <input
                    type="range"
                    min="20"
                    max="600"
                    value={selectedElement.width}
                    onChange={(e) => handleUpdateSelected({ width: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">Alto</label>
                  <input
                    type="range"
                    min="20"
                    max="400"
                    value={selectedElement.height}
                    onChange={(e) => handleUpdateSelected({ height: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">Transparencia: {Math.round(selectedElement.opacity * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedElement.opacity}
                    onChange={(e) => handleUpdateSelected({ opacity: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">Curva de esquinas: {selectedElement.imageBorderRadius || 0}px</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedElement.imageBorderRadius || 0}
                    onChange={(e) => handleUpdateSelected({ imageBorderRadius: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">Grosor de borde: {selectedElement.imageBorderWidth || 0}px</label>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={selectedElement.imageBorderWidth || 0}
                    onChange={(e) => handleUpdateSelected({ imageBorderWidth: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">Color de borde</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedElement.imageBorderColor || '#000000'}
                      onChange={(e) => handleUpdateSelected({ imageBorderColor: e.target.value })}
                      className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                    />
                    <input
                      type="text"
                      value={selectedElement.imageBorderColor || '#000000'}
                      onChange={(e) => handleUpdateSelected({ imageBorderColor: e.target.value })}
                      className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              </>
            )}
            {selectedElement.type === 'text' && (
              <div className="space-y-2">
                <textarea
                  value={selectedElement.text}
                  onChange={(e) => handleUpdateSelected({ text: e.target.value })}
                  className="w-full rounded-md border border-gray-700 bg-gray-900 p-2 text-sm"
                  rows={3}
                />
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-gray-500">Rotación</span>
              <input
                type="range"
                min="0"
                max="360"
                value={selectedElement.rotation}
                onChange={(e) => handleUpdateSelected({ rotation: Number(e.target.value) })}
                className="w-32"
              />
            </div>

            {selectedElement && (
              <div className="mt-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Animación</h4>
                <div className="space-y-2">
                  <select
                    value={animation}
                    onChange={(e) => {
                      setAnimation(e.target.value)
                      handleUpdateAnimation({ animation: e.target.value || null })
                    }}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  >
                    <option value="">Sin animación</option>
                    <option value="fadeIn">Aparición (fade in)</option>
                    <option value="fadeOut">Desaparición (fade out)</option>
                    <option value="slideInLeft">Entrada izquierda</option>
                    <option value="slideInRight">Entrada derecha</option>
                    <option value="slideInUp">Entrada inferior</option>
                    <option value="slideInDown">Entrada superior</option>
                    <option value="bounceIn">Rebote</option>
                    <option value="pulse">Pulso</option>
                    <option value="shake">Sacudida</option>
                    <option value="zoomIn">Zoom in</option>
                    <option value="flipInX">Volteo horizontal</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-14">Duración</span>
                    <input
                      type="number"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={animationDuration}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setAnimationDuration(v)
                        handleUpdateAnimation({ animationDuration: v })
                      }}
                      className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-gray-500">s</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-14">Retraso</span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="0.1"
                      value={animationDelay}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setAnimationDelay(v)
                        handleUpdateAnimation({ animationDelay: v })
                      }}
                      className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-gray-500">s</span>
            </div>
          </div>
          {selectedElement?.type === 'text' && (
            <div className="mt-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Borde del texto</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Color</span>
                <input
                  type="color"
                  value={selectedElement.textStrokeColor || '#000000'}
                  onChange={(e) => handleUpdateSelected({ textStrokeColor: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded border border-gray-700 bg-gray-900"
                />
                <input
                  type="text"
                  value={selectedElement.textStrokeColor || '#000000'}
                  onChange={(e) => handleUpdateSelected({ textStrokeColor: e.target.value })}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Grosor</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={selectedElement.textStrokeWidth || 0}
                  onChange={(e) => handleUpdateSelected({ textStrokeWidth: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">{(selectedElement.textStrokeWidth || 0)}</span>
              </div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Sombra</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Color</span>
                <input
                  type="color"
                  value={selectedElement.textShadowColor || '#000000'}
                  onChange={(e) => handleUpdateSelected({ textShadowColor: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded border border-gray-700 bg-gray-900"
                />
                <input
                  type="text"
                  value={selectedElement.textShadowColor || '#000000'}
                  onChange={(e) => handleUpdateSelected({ textShadowColor: e.target.value })}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">X</span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={selectedElement.textShadowX ?? 0}
                  onChange={(e) => handleUpdateSelected({ textShadowX: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{(selectedElement.textShadowX ?? 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Y</span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={selectedElement.textShadowY ?? 0}
                  onChange={(e) => handleUpdateSelected({ textShadowY: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{(selectedElement.textShadowY ?? 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Blur</span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={selectedElement.textShadowBlur ?? 0}
                  onChange={(e) => handleUpdateSelected({ textShadowBlur: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{(selectedElement.textShadowBlur ?? 0)}</span>
              </div>
            </div>
          )}
        </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-500">
            Selecciona un elemento para editar sus propiedades.
          </div>
        )}
      </div>
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-lg p-2 text-xs transition ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ------------------------------------------------------------------
// Code Panel Component
// ------------------------------------------------------------------

function CodePanel({
  code,
  onChange,
  chat,
  chatInput,
  setChatInput,
  onSend,
  isGenerating,
}: {
  code: string
  onChange: (code: string) => void
  chat: ChatMessage[]
  chatInput: string
  setChatInput: React.Dispatch<React.SetStateAction<string>>
  onSend: () => void
  isGenerating: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const newValue = code.substring(0, start) + '  ' + code.substring(end)
      onChange(newValue)
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2
        }
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1">
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Código HTML</h3>
            <span className="text-xs text-gray-600">{code.length} caracteres</span>
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-[50vh] w-full rounded-md border border-gray-700 bg-gray-900 p-3 font-mono text-sm text-gray-200"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="w-full lg:w-80 shrink-0 space-y-4">
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Chat IA</h3>
          <div className="flex h-64 flex-col gap-2 overflow-y-auto">
            {chat.length === 0 ? (
              <p className="text-sm text-gray-600">Pregunta sobre tu diseño o pide mejoras.</p>
            ) : (
              chat.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600/20 text-blue-200'
                      : 'bg-gray-800 text-gray-300'
                  }`}
                >
                  {msg.content}
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSend()
                }
              }}
              placeholder="Escribe un mensaje..."
              className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
            />
            <button
              onClick={onSend}
              disabled={isGenerating}
              className="rounded-md bg-blue-600 px-3 py-2 text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Model Settings Modal
// ------------------------------------------------------------------

function ModelSettingsModal({
  open,
  onClose,
  models,
  setModels,
}: {
  open: boolean
  onClose: () => void
  models: ModelConfig[]
  setModels: (models: ModelConfig[]) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ModelType>('text')
  const [provider, setProvider] = useState<ModelProvider>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')

  if (!open) return null

  const handleAdd = () => {
    if (!name.trim() || !modelId.trim()) return
    setModels([
      ...models,
      {
        id: `model-${Date.now()}`,
        name: name.trim(),
        type,
        provider,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelId: modelId.trim(),
      },
    ])
    setName('')
    setBaseUrl('')
    setApiKey('')
    setModelId('')
  }

  const handleRemove = (id: string) => {
    setModels(models.filter((m) => m.id !== id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-950 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Configurar Modelos</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 transition hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Nombre del modelo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ModelType)}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
            >
              <option value="text">Texto</option>
              <option value="vision">Visión</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ModelProvider)}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="custom">Custom</option>
              <option value="local">Local</option>
            </select>
            <input
              type="text"
              placeholder="Model ID"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
            />
          </div>
          <input
            type="text"
            placeholder="Base URL (opcional)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
          />
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
          />
          <button
            onClick={handleAdd}
            className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Agregar modelo
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {models.length === 0 ? (
            <p className="text-sm text-gray-600">No hay modelos configurados.</p>
          ) : (
            models.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between rounded-md border border-gray-800 bg-gray-900 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-200">{model.name}</p>
                  <p className="text-xs text-gray-500">
                    {model.type} · {model.provider} · {model.modelId}
                  </p>
                </div>
                <button
                  onClick={() => handleRemove(model.id)}
                  className="rounded-md p-1 text-red-400 transition hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
