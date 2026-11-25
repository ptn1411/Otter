import { useEffect, useRef } from "react"
import type { RefObject } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import type { OtterA2a } from "../otter/live"
import type { OfficeMember, OfficeState, WorkPhase } from "../game/types"

export type SceneSnapshot = {
  members: OfficeMember[]
  state: OfficeState
  a2a: OtterA2a | null
  liveOk: boolean
  version: string
}

type Props = {
  snapshotRef: RefObject<SceneSnapshot>
  onSelect: (id: string) => void
}

const ROOM_X = 11.8
const ROOM_Z = 8.6

// 12 bàn công thái học chia 3 dãy rộng rãi, có lối đi trung tâm cho luồng bàn giao A2A
const DESKS = [
  // Dãy 1 (hàng trên, gần bảng Hub)
  { x: -7.2, z: -3.1 },
  { x: -2.4, z: -3.1 },
  { x: 2.4, z: -3.1 },
  { x: 7.2, z: -3.1 },
  // Dãy 2 (hàng giữa)
  { x: -7.2, z: 1.4 },
  { x: -2.4, z: 1.4 },
  { x: 2.4, z: 1.4 },
  { x: 7.2, z: 1.4 },
  // Dãy 3 (hàng dưới, mở rộng khi có >8 agent)
  { x: -7.2, z: 5.5 },
  { x: -2.4, z: 5.5 },
  { x: 2.4, z: 5.5 },
  { x: 7.2, z: 5.5 },
]

// Hướng bàn về phía +Z để góc nhìn isometric (+X, +Y, +Z) thấy rõ khuôn mặt, ánh mắt, trang phục và bàn tay gõ phím của từng nhân vật
const DESK_YAW = 0

type Rig = {
  id: string
  desk: number
  group: THREE.Group
  body: THREE.Group
  head: THREE.Group
  lidL: THREE.Mesh
  lidR: THREE.Mesh
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  hipL: THREE.Group
  hipR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  packet: THREE.Mesh
  ring: THREE.Mesh
  labelCanvas: HTMLCanvasElement
  labelTex: THREE.CanvasTexture
  owned: THREE.Material[]
  lastLabel: string
  blinkSeed: number
}

type ScreenView = {
  canvas: HTMLCanvasElement
  tex: THREE.CanvasTexture
  ledMat: THREE.MeshStandardMaterial
  key: string
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function wrapFill(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (g.measureText(next).width > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  lines.slice(0, maxLines).forEach((row, index) => {
    const textRow = index === maxLines - 1 && lines.length > maxLines ? `${row.slice(0, Math.max(0, row.length - 1))}…` : row
    g.fillText(textRow, x, y + index * lineHeight)
  })
}

function phaseColor(phase: WorkPhase): string {
  if (phase === "working") return "#10B981"
  if (phase === "queued") return "#38BDF8"
  if (phase === "error") return "#F43F5E"
  if (phase === "idle") return "#F59E0B"
  return "#475569"
}

function phaseLabel(phase: WorkPhase): string {
  if (phase === "working") return "ĐANG CHẠY"
  if (phase === "queued") return "CHỜ KÉO"
  if (phase === "error") return "CẦN XỬ LÝ"
  if (phase === "idle") return "SẴN SÀNG"
  return "NGOẠI TUYẾN"
}

function drawScreen(view: ScreenView, member: OfficeMember | null, cursorOn: boolean) {
  const phase = member?.phase ?? "offline"
  const key = `${member?.botId ?? "empty"}|${phase}|${member?.task ?? ""}|${member?.taskMeta ?? ""}|${cursorOn ? 1 : 0}`
  if (view.key === key) return
  view.key = key

  const accent = member ? phaseColor(member.phase) : "#334155"
  view.ledMat.color.set(accent)
  view.ledMat.emissive.set(accent)
  view.ledMat.emissiveIntensity = !member || phase === "offline" ? 0.15 : phase === "working" ? 1.5 : 0.9

  const g = view.canvas.getContext("2d")
  if (!g) return
  g.clearRect(0, 0, 640, 380)

  if (!member || phase === "offline") {
    g.fillStyle = "#0B1018"
    g.fillRect(0, 0, 640, 380)
    g.strokeStyle = "rgba(148,163,184,0.16)"
    g.lineWidth = 4
    roundRect(g, 18, 18, 604, 344, 18)
    g.stroke()
    g.fillStyle = "#475569"
    g.font = "700 32px IBM Plex Sans, ui-sans-serif, sans-serif"
    g.textAlign = "center"
    g.fillText(member ? member.shortName : "BÀN TRỐNG", 320, 175)
    g.font = "600 22px IBM Plex Sans, ui-sans-serif, sans-serif"
    g.fillStyle = "#334155"
    g.fillText(member ? "Chế độ chờ · Ngoại tuyến" : "Sẵn sàng thêm Agent A2A", 320, 220)
    g.textAlign = "left"
    view.tex.needsUpdate = true
    return
  }

  g.fillStyle = "#0D131E"
  g.fillRect(0, 0, 640, 380)
  // Header bar
  g.fillStyle = "#161F2E"
  g.fillRect(0, 0, 640, 64)
  g.fillStyle = member.color
  g.fillRect(0, 0, 10, 64)

  g.fillStyle = "#F8FAFC"
  g.font = "700 28px IBM Plex Sans, ui-sans-serif, sans-serif"
  g.textAlign = "left"
  g.textBaseline = "middle"
  g.fillText(member.shortName, 26, 32)

  // Status pill
  g.fillStyle = accent
  roundRect(g, 430, 16, 188, 32, 16)
  g.fill()
  g.fillStyle = "#081018"
  g.font = "700 17px IBM Plex Sans, ui-sans-serif, sans-serif"
  g.textAlign = "center"
  g.fillText(phaseLabel(member.phase), 524, 33)

  // Body content
  g.textAlign = "left"
  g.textBaseline = "alphabetic"
  g.fillStyle = "#F8FAFC"
  g.font = "700 34px IBM Plex Sans, ui-sans-serif, sans-serif"
  wrapFill(g, member.task, 26, 126, 588, 44, 3)

  if (member.taskMeta) {
    g.fillStyle = "#94A3B8"
    g.font = "600 22px IBM Plex Sans, ui-sans-serif, sans-serif"
    g.fillText(member.taskMeta.slice(0, 48), 26, 290)
  }

  // Bottom code/telemetry bar
  g.fillStyle = "#151E2D"
  g.fillRect(0, 322, 640, 58)
  g.fillStyle = "#64748B"
  g.font = "600 20px IBM Plex Sans, ui-sans-serif, sans-serif"
  g.fillText(member.node ? `Node: ${member.node}` : member.role, 26, 358)

  if (cursorOn && (phase === "working" || phase === "queued")) {
    g.fillStyle = accent
    g.fillRect(588, 338, 22, 24)
  }

  view.tex.needsUpdate = true
}

function makeTexture(w: number, h: number) {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return { canvas, tex, ctx: canvas.getContext("2d")! }
}

export default function OfficeScene({ snapshotRef, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const view: HTMLCanvasElement = canvas

    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const rigs: Rig[] = []

    const scene = new THREE.Scene()
    scene.background = new THREE.Color("#0C111B")
    scene.fog = new THREE.Fog("#0C111B", 38, 72)

    const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, alpha: false, powerPreference: "high-performance" })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08

    const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200)
    camera.position.set(22, 21, 22)
    camera.zoom = 0.96

    const defaultTarget = new THREE.Vector3(-1.1, 0.7, 0.9)
    const desiredTarget = defaultTarget.clone()

    const controls = new OrbitControls(camera, view)
    controls.target.copy(defaultTarget)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = true
    controls.screenSpacePanning = false
    controls.minPolarAngle = 0.45
    controls.maxPolarAngle = Math.PI / 2.25
    controls.minAzimuthAngle = Math.PI / 4 - 0.65
    controls.maxAzimuthAngle = Math.PI / 4 + 0.55
    controls.minZoom = 0.62
    controls.maxZoom = 2.6
    controls.update()

    // Ánh sáng studio 3 điểm điện ảnh — làm rõ khuôn mặt, trang phục và chiều sâu phòng 3D
    const hemi = new THREE.HemisphereLight(0xe2f0ff, 0x2a3548, 1.35)
    scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xfff6ea, 1.65)
    sun.position.set(16, 25, 18)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -28
    sun.shadow.camera.right = 28
    sun.shadow.camera.top = 28
    sun.shadow.camera.bottom = -28
    sun.shadow.camera.near = 2
    sun.shadow.camera.far = 75
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    scene.add(sun)
    scene.add(sun.target)

    const frontFill = new THREE.DirectionalLight(0xc7e2ff, 0.55)
    frontFill.position.set(14, 12, 22)
    scene.add(frontFill)

    const rimLight = new THREE.DirectionalLight(0x34d399, 0.45)
    rimLight.position.set(-14, 10, -10)
    scene.add(rimLight)

    const hubGlow = new THREE.PointLight(0x10b981, 1.1, 12, 2)
    hubGlow.position.set(0, 1.4, -0.8)
    scene.add(hubGlow)

    // Vật liệu kiến trúc hiện đại (độ tương phản sáng-tối rõ nét)
    const wallMat = new THREE.MeshStandardMaterial({ color: "#1D2638", roughness: 0.84, metalness: 0.05 })
    const wallTrimMat = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.7, metalness: 0.15 })
    const walnutMat = new THREE.MeshStandardMaterial({ color: "#5E4536", roughness: 0.52, metalness: 0.06 })
    const matPadMat = new THREE.MeshStandardMaterial({ color: "#151E2E", roughness: 0.86, metalness: 0.04 })
    const steelMat = new THREE.MeshStandardMaterial({ color: "#283548", roughness: 0.35, metalness: 0.62 })
    const chromeMat = new THREE.MeshStandardMaterial({ color: "#8093AC", roughness: 0.25, metalness: 0.75 })
    const chairMeshMat = new THREE.MeshStandardMaterial({ color: "#222E42", roughness: 0.78, metalness: 0.08 })
    const glassMat = new THREE.MeshStandardMaterial({
      color: "#38BDF8",
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.25,
    })
    const ceramicMat = new THREE.MeshStandardMaterial({ color: "#F1F5F9", roughness: 0.32, metalness: 0.05 })
    const potMat = new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.72, metalness: 0.08 })
    const soilMat = new THREE.MeshStandardMaterial({ color: "#3A2A20", roughness: 0.95 })
    const leafAMat = new THREE.MeshStandardMaterial({ color: "#22C55E", roughness: 0.62 })
    const leafBMat = new THREE.MeshStandardMaterial({ color: "#16A34A", roughness: 0.68 })
    const yardMat = new THREE.MeshStandardMaterial({ color: "#0B101A", roughness: 1 })
    const pendantMat = new THREE.MeshStandardMaterial({
      color: "#34D399",
      emissive: "#10B981",
      emissiveIntensity: 1.1,
      roughness: 0.25,
    })
    mats.push(
      wallMat,
      wallTrimMat,
      walnutMat,
      matPadMat,
      steelMat,
      chromeMat,
      chairMeshMat,
      glassMat,
      ceramicMat,
      potMat,
      soilMat,
      leafAMat,
      leafBMat,
      yardMat,
      pendantMat,
    )

    // Sàn gỗ công nghiệp slate trung tính rõ vân & đổ bóng mềm
    const { canvas: floorCanvas, tex: floorTex } = makeTexture(512, 512)
    const floorCtx = floorCanvas.getContext("2d")!
    floorCtx.fillStyle = "#1B2434"
    floorCtx.fillRect(0, 0, 512, 512)
    for (let y = 0; y < 512; y += 32) {
      floorCtx.fillStyle = y % 64 === 0 ? "#202A3C" : "#1D2637"
      floorCtx.fillRect(0, y, 512, 30)
      floorCtx.strokeStyle = "rgba(148, 163, 184, 0.12)"
      floorCtx.strokeRect(0.5, y + 0.5, 511, 30)
      floorCtx.beginPath()
      const seam = (y / 32) % 2 === 0 ? 84 : 172
      for (let x = seam; x < 512; x += 192) {
        floorCtx.moveTo(x, y + 2)
        floorCtx.lineTo(x, y + 28)
      }
      floorCtx.stroke()
    }
    floorTex.needsUpdate = true
    floorTex.wrapS = THREE.RepeatWrapping
    floorTex.wrapT = THREE.RepeatWrapping
    floorTex.repeat.set(2.2, 1.8)
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.05 })
    mats.push(floorMat)

    function addMesh(
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = scene,
      shadow = true,
    ) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(x, y, z)
      mesh.castShadow = shadow
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }

    function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, parent: THREE.Object3D = scene, shadow = true) {
      const geometry = new THREE.BoxGeometry(w, h, d)
      geos.push(geometry)
      return addMesh(geometry, material, x, y, z, parent, shadow)
    }

    function rounded(w: number, h: number, d: number, radius: number, x: number, y: number, z: number, material: THREE.Material, parent: THREE.Object3D = scene, shadow = true) {
      const geometry = new RoundedBoxGeometry(w, h, d, 2, radius)
      geos.push(geometry)
      return addMesh(geometry, material, x, y, z, parent, shadow)
    }

    function cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, material: THREE.Material, parent: THREE.Object3D = scene, segs = 14) {
      const geometry = new THREE.CylinderGeometry(rTop, rBot, h, segs)
      geos.push(geometry)
      return addMesh(geometry, material, x, y, z, parent)
    }

    // Nền ngoài & sàn phòng
    const yard = new THREE.BoxGeometry(72, 0.2, 72)
    geos.push(yard)
    addMesh(yard, yardMat, 0, -0.18, 0, scene, false)

    const floorGeo = new THREE.BoxGeometry(ROOM_X * 2, 0.24, ROOM_Z * 2)
    geos.push(floorGeo)
    addMesh(floorGeo, floorMat, 0, 0.02, 0)

    // Tường & cửa sổ kính toàn cảnh
    const wallH = 3.6
    function wallX(z0: number, z1: number, y0: number, y1: number) {
      box(0.32, y1 - y0, z1 - z0, -ROOM_X, (y0 + y1) / 2, (z0 + z1) / 2, wallMat)
    }
    function wallZ(x0: number, x1: number, y0: number, y1: number) {
      box(x1 - x0, y1 - y0, 0.32, (x0 + x1) / 2, (y0 + y1) / 2, -ROOM_Z, wallMat)
    }
    function windowX(z: number) {
      wallX(z - 1.3, z + 1.3, 0, 0.95)
      wallX(z - 1.3, z + 1.3, 2.85, wallH)
      box(0.08, 1.85, 2.48, -ROOM_X + 0.16, 1.9, z, glassMat, scene, false)
      box(0.12, 0.08, 2.6, -ROOM_X + 0.18, 2.84, z, steelMat, scene, false)
      box(0.12, 0.08, 2.6, -ROOM_X + 0.18, 0.96, z, steelMat, scene, false)
      box(0.12, 1.88, 0.08, -ROOM_X + 0.18, 1.9, z - 1.26, steelMat, scene, false)
      box(0.12, 1.88, 0.08, -ROOM_X + 0.18, 1.9, z + 1.26, steelMat, scene, false)
    }
    function windowZ(x: number) {
      wallZ(x - 1.4, x + 1.4, 0, 0.95)
      wallZ(x - 1.4, x + 1.4, 2.85, wallH)
      box(2.68, 1.85, 0.08, x, 1.9, -ROOM_Z + 0.16, glassMat, scene, false)
      box(2.8, 0.08, 0.12, x, 2.84, -ROOM_Z + 0.18, steelMat, scene, false)
      box(2.8, 0.08, 0.12, x, 0.96, -ROOM_Z + 0.18, steelMat, scene, false)
      box(0.08, 1.88, 0.12, x - 1.36, 1.9, -ROOM_Z + 0.18, steelMat, scene, false)
      box(0.08, 1.88, 0.12, x + 1.36, 1.9, -ROOM_Z + 0.18, steelMat, scene, false)
    }

    wallX(-ROOM_Z, -5.8, 0, wallH)
    windowX(-4.5)
    wallX(-3.2, -1.3, 0, wallH)
    windowX(0)
    wallX(1.3, 3.2, 0, wallH)
    windowX(4.5)
    wallX(5.8, ROOM_Z, 0, wallH)

    wallZ(-ROOM_X, 3.4, 0, wallH)
    windowZ(4.8)
    wallZ(6.2, 7.2, 0, wallH)
    windowZ(8.6)
    wallZ(10.0, ROOM_X, 0, wallH)

    // Len chân tường (baseboard)
    box(ROOM_X * 2, 0.16, 0.06, 0, 0.2, -ROOM_Z + 0.18, wallTrimMat, scene, false)
    box(0.06, 0.16, ROOM_Z * 2, -ROOM_X + 0.18, 0.2, 0, wallTrimMat, scene, false)

    // Dải LED kiến trúc chạy dọc viền trên tường hậu (không chắn tầm nhìn camera isometric)
    box(ROOM_X * 2 - 0.4, 0.045, 0.05, 0, wallH - 0.08, -ROOM_Z + 0.18, pendantMat, scene, false)
    box(0.05, 0.045, ROOM_Z * 2 - 0.4, -ROOM_X + 0.18, wallH - 0.08, 0, pendantMat, scene, false)

    // Cây xanh nội thất chậu gốm ở các góc
    function addIndoorPlant(x: number, z: number) {
      const g = new THREE.Group()
      g.position.set(x, 0.14, z)
      scene.add(g)
      cyl(0.32, 0.24, 0.52, 0, 0.26, 0, potMat, g)
      cyl(0.28, 0.28, 0.04, 0, 0.51, 0, soilMat, g)
      const leafGeo = new THREE.SphereGeometry(0.26, 12, 10)
      geos.push(leafGeo)
      const offsets = [
        [0, 0.92, 0, 1.0, 1.4, 1.0],
        [-0.22, 0.78, 0.16, 0.85, 1.15, 0.85],
        [0.24, 0.82, -0.12, 0.9, 1.2, 0.9],
        [0.06, 1.16, 0.08, 0.75, 1.1, 0.75],
      ]
      offsets.forEach(([ox, oy, oz, sx, sy, sz], i) => {
        const m = addMesh(leafGeo, i % 2 === 0 ? leafAMat : leafBMat, ox, oy, oz, g)
        m.scale.set(sx, sy, sz)
      })
    }
    addIndoorPlant(-10.5, -7.2)
    addIndoorPlant(10.5, -7.2)
    addIndoorPlant(-10.5, 7.2)
    addIndoorPlant(10.5, 7.2)

    // Đảo kết nối A2A Hub trung tâm trên sàn (vòng phát sáng emerald)
    const hubRingGeo = new THREE.RingGeometry(1.15, 1.32, 48)
    geos.push(hubRingGeo)
    const hubRingMat = new THREE.MeshBasicMaterial({ color: "#10B981", transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    mats.push(hubRingMat)
    const hubRing = new THREE.Mesh(hubRingGeo, hubRingMat)
    hubRing.rotation.x = -Math.PI / 2
    hubRing.position.set(0, 0.148, -0.8)
    scene.add(hubRing)

    const hubInnerGeo = new THREE.CircleGeometry(1.14, 48)
    geos.push(hubInnerGeo)
    const hubInnerMat = new THREE.MeshStandardMaterial({ color: "#0F1D24", roughness: 0.7, metalness: 0.2 })
    mats.push(hubInnerMat)
    const hubInner = new THREE.Mesh(hubInnerGeo, hubInnerMat)
    hubInner.rotation.x = -Math.PI / 2
    hubInner.position.set(0, 0.145, -0.8)
    hubInner.receiveShadow = true
    scene.add(hubInner)

    // Biển tên tường OTTER HUB
    const signPaint = makeTexture(640, 140)
    const signMat = new THREE.MeshStandardMaterial({ map: signPaint.tex, roughness: 0.35, metalness: 0.1 })
    mats.push(signMat)
    rounded(3.4, 0.66, 0.12, 0.08, 1.0, 2.95, -ROOM_Z + 0.24, signMat)
    {
      const g = signPaint.ctx
      g.fillStyle = "#0D1A18"
      roundRect(g, 6, 6, 628, 128, 24)
      g.fill()
      g.strokeStyle = "#10B981"
      g.lineWidth = 5
      roundRect(g, 8, 8, 624, 124, 24)
      g.stroke()
      g.fillStyle = "#34D399"
      g.beginPath()
      g.arc(54, 70, 14, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = "#F8FAFC"
      g.font = "700 50px IBM Plex Sans, ui-sans-serif, sans-serif"
      g.textAlign = "left"
      g.textBaseline = "middle"
      g.fillText("OTTER A2A HUB", 88, 72)
      signPaint.tex.needsUpdate = true
    }

    // Bảng tường hiển thị tiến độ A2A & trạng thái từng thành viên thật
    const boardPaint = makeTexture(960, 620)
    const boardMat = new THREE.MeshStandardMaterial({ map: boardPaint.tex, roughness: 0.4 })
    mats.push(boardMat)
    box(5.6, 3.05, 0.12, -5.6, 1.88, -ROOM_Z + 0.22, steelMat)
    const boardPlaneGeo = new THREE.PlaneGeometry(5.36, 2.86)
    geos.push(boardPlaneGeo)
    const board = new THREE.Mesh(boardPlaneGeo, boardMat)
    board.position.set(-5.6, 1.88, -ROOM_Z + 0.29)
    scene.add(board)

    function drawBoard(snap: SceneSnapshot) {
      const g = boardPaint.ctx
      g.clearRect(0, 0, 960, 620)
      g.fillStyle = "#0F1622"
      g.fillRect(0, 0, 960, 620)
      g.fillStyle = "#10B981"
      g.fillRect(0, 0, 960, 8)

      g.fillStyle = "#F8FAFC"
      g.font = "700 34px IBM Plex Sans, ui-sans-serif, sans-serif"
      g.textAlign = "left"
      g.textBaseline = "alphabetic"
      g.fillText("ĐIỀU PHỐI PHÒNG BAN OTTER", 32, 54)

      const a2a = snap.a2a
      const statsText = a2a
        ? `Chờ: ${a2a.queued} · Đang làm: ${a2a.inFlight} · Xong: ${a2a.acked} · Lỗi: ${a2a.failed}`
        : snap.liveOk
          ? `Otter v${snap.version} · Đã kết nối`
          : "Đang chờ kết nối Otter daemon…"
      g.fillStyle = "#94A3B8"
      g.font = "600 22px IBM Plex Sans, ui-sans-serif, sans-serif"
      g.fillText(statsText, 32, 88)

      const shown = snap.members.slice(0, 8)
      const cols = shown.length > 5 ? 2 : 1
      const colW = cols === 2 ? 444 : 896
      const rowH = cols === 2 ? 116 : 92

      shown.forEach((m, i) => {
        const col = cols === 2 ? i % 2 : 0
        const row = cols === 2 ? Math.floor(i / 2) : i
        const x = 32 + col * (colW + 12)
        const y = 114 + row * (rowH + 10)
        g.fillStyle = "#161F2E"
        roundRect(g, x, y, colW, rowH, 16)
        g.fill()
        g.fillStyle = phaseColor(m.phase)
        g.beginPath()
        g.arc(x + 26, y + 32, 9, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = "#F8FAFC"
        g.font = "700 24px IBM Plex Sans, ui-sans-serif, sans-serif"
        g.fillText(m.shortName, x + 48, y + 38)

        g.fillStyle = "#64748B"
        g.font = "600 17px IBM Plex Sans, ui-sans-serif, sans-serif"
        g.textAlign = "right"
        g.fillText(m.node ?? m.role, x + colW - 18, y + 36)
        g.textAlign = "left"

        g.fillStyle = "#CBD5E1"
        g.font = "500 19px IBM Plex Sans, ui-sans-serif, sans-serif"
        const limit = cols === 2 ? 30 : 62
        const snippet = m.task.length > limit ? `${m.task.slice(0, limit - 1)}…` : m.task
        g.fillText(snippet, x + 48, y + 74)
      })
      boardPaint.tex.needsUpdate = true
    }

    // 12 bàn làm việc công thái học + ghế xoay công thái học
    const screenViews: ScreenView[] = []
    const deskGroups: THREE.Group[] = []
    const seatAnchors: THREE.Object3D[] = []

    DESKS.forEach((desk, index) => {
      const group = new THREE.Group()
      group.position.set(desk.x, 0, desk.z)
      group.rotation.y = DESK_YAW
      scene.add(group)
      deskGroups.push(group)
      group.visible = index < 6

      // Mặt bàn gỗ óc chó + khung chân thép chữ T
      rounded(2.05, 0.08, 0.96, 0.03, 0, 0.76, 0, walnutMat, group)
      for (const sx of [-0.84, 0.84]) {
        box(0.06, 0.68, 0.06, sx, 0.4, 0, steelMat, group)
        rounded(0.08, 0.04, 0.76, 0.015, sx, 0.14, 0, steelMat, group)
      }
      box(1.68, 0.04, 0.04, 0, 0.64, 0.22, steelMat, group, false)

      // Lót chuột lớn, bàn phím cơ & chuột
      rounded(0.92, 0.01, 0.36, 0.005, 0, 0.805, -0.2, matPadMat, group, false)
      rounded(0.46, 0.025, 0.15, 0.008, -0.08, 0.82, -0.22, steelMat, group, false)
      rounded(0.07, 0.025, 0.11, 0.012, 0.28, 0.82, -0.22, steelMat, group, false)

      // Cốc cà phê trên góc bàn
      cyl(0.045, 0.04, 0.095, 0.72, 0.85, -0.14, ceramicMat, group)

      // Đèn LED báo trạng thái góc bàn
      const ledMat = new THREE.MeshStandardMaterial({
        color: "#475569",
        emissive: "#475569",
        emissiveIntensity: 0.4,
        roughness: 0.25,
      })
      mats.push(ledMat)
      rounded(0.32, 0.025, 0.035, 0.01, -0.68, 0.815, 0.36, ledMat, group, false)

      // Màn hình ultrawide đặt lệch trái góc bàn và hơi xoay về phía người ngồi — thấy rõ cả khuôn mặt lẫn nội dung màn hình
      const paint = makeTexture(640, 380)
      const screenMat = new THREE.MeshBasicMaterial({ map: paint.tex, side: THREE.FrontSide })
      mats.push(screenMat)
      screenViews.push({ canvas: paint.canvas, tex: paint.tex, ledMat, key: "" })

      const monitor = new THREE.Group()
      monitor.position.set(-0.32, 0, 0.24)
      monitor.rotation.y = Math.PI - 0.22
      group.add(monitor)
      rounded(1.18, 0.66, 0.05, 0.025, 0, 1.24, -0.02, steelMat, monitor)
      const displayGeo = new THREE.PlaneGeometry(1.1, 0.58)
      geos.push(displayGeo)
      const display = new THREE.Mesh(displayGeo, screenMat)
      display.position.set(0, 1.24, 0.01)
      monitor.add(display)
      // Chân đế kim loại
      box(0.07, 0.22, 0.045, 0, 0.88, -0.04, chromeMat, monitor)
      rounded(0.36, 0.025, 0.2, 0.01, 0, 0.815, -0.02, chromeMat, monitor)

      // Ghế công thái học có tay vịn & chân 5 chấu
      const seat = new THREE.Group()
      seat.position.set(0, 0, -0.88)
      group.add(seat)
      seatAnchors.push(seat)

      rounded(0.54, 0.07, 0.5, 0.03, 0, 0.48, 0.02, chairMeshMat, seat)
      rounded(0.5, 0.56, 0.07, 0.03, 0, 0.82, -0.22, chairMeshMat, seat)
      // Tay vịn trái/phải
      for (const ax of [-0.28, 0.28]) {
        box(0.04, 0.18, 0.04, ax, 0.57, -0.02, steelMat, seat)
        rounded(0.06, 0.03, 0.28, 0.012, ax, 0.67, 0.02, chairMeshMat, seat)
      }
      cyl(0.035, 0.035, 0.34, 0, 0.28, 0, chromeMat, seat)
      for (let spoke = 0; spoke < 5; spoke += 1) {
        const ang = (spoke / 5) * Math.PI * 2
        const leg = box(0.04, 0.035, 0.28, Math.sin(ang) * 0.14, 0.13, Math.cos(ang) * 0.14, steelMat, seat)
        leg.rotation.y = ang
      }
    })
    scene.updateMatrixWorld(true)

    // Shared geometries cho nhân vật Stylized Humanoid chân thật
    const headGeo = new THREE.SphereGeometry(0.24, 28, 22)
    const neckGeo = new THREE.CapsuleGeometry(0.062, 0.08, 6, 12)
    const puffGeo = new THREE.SphereGeometry(0.24, 20, 14)
    const torsoGeo = new THREE.CapsuleGeometry(0.185, 0.28, 8, 16)
    const pelvisGeo = new RoundedBoxGeometry(0.36, 0.16, 0.23, 3, 0.06)
    const shoulderCapGeo = new THREE.SphereGeometry(0.078, 14, 10)
    const upperArmGeo = new THREE.CapsuleGeometry(0.056, 0.18, 6, 12)
    const foreArmGeo = new THREE.CapsuleGeometry(0.048, 0.18, 6, 12)
    const handGeo = new THREE.SphereGeometry(0.044, 10, 8)
    const thighGeo = new THREE.CapsuleGeometry(0.072, 0.24, 6, 12)
    const shinGeo = new THREE.CapsuleGeometry(0.056, 0.26, 6, 12)
    const shoeGeo = new RoundedBoxGeometry(0.11, 0.07, 0.22, 2, 0.03)
    const eyeWhiteGeo = new THREE.SphereGeometry(0.032, 14, 10)
    const irisGeo = new THREE.SphereGeometry(0.02, 12, 8)
    const pupilGeo = new THREE.SphereGeometry(0.011, 10, 8)
    const sparkGeo = new THREE.SphereGeometry(0.0055, 8, 6)
    const lidGeo = new THREE.BoxGeometry(0.072, 0.026, 0.02)
    const browGeo = new THREE.CapsuleGeometry(0.009, 0.055, 4, 8)
    const smileGeo = new THREE.TorusGeometry(0.032, 0.0065, 6, 14, Math.PI)
    const glassGeo = new THREE.TorusGeometry(0.054, 0.006, 8, 20)
    const headphoneBandGeo = new THREE.TorusGeometry(0.235, 0.018, 8, 24, Math.PI)
    const headphoneCupGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.045, 16)
    const packetGeo = new RoundedBoxGeometry(0.18, 0.22, 0.028, 2, 0.01)
    const ringGeo = new THREE.RingGeometry(0.42, 0.48, 36)

    geos.push(
      headGeo,
      neckGeo,
      puffGeo,
      torsoGeo,
      pelvisGeo,
      shoulderCapGeo,
      upperArmGeo,
      foreArmGeo,
      handGeo,
      thighGeo,
      shinGeo,
      shoeGeo,
      eyeWhiteGeo,
      irisGeo,
      pupilGeo,
      sparkGeo,
      lidGeo,
      browGeo,
      smileGeo,
      glassGeo,
      headphoneBandGeo,
      headphoneCupGeo,
      packetGeo,
      ringGeo,
    )

    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: "#F8FAFC", roughness: 0.25 })
    const pupilMat = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.2 })
    const sparkMat = new THREE.MeshBasicMaterial({ color: "#FFFFFF" })
    const shoeMat = new THREE.MeshStandardMaterial({ color: "#E2E8F0", roughness: 0.45 })
    const lipMat = new THREE.MeshStandardMaterial({ color: "#C97A7E", roughness: 0.45 })
    const headphoneMat = new THREE.MeshStandardMaterial({ color: "#0F172A", roughness: 0.3, metalness: 0.55 })
    const glassFrameMat = new THREE.MeshStandardMaterial({ color: "#CBD5E1", roughness: 0.2, metalness: 0.8 })
    mats.push(eyeWhiteMat, pupilMat, sparkMat, shoeMat, lipMat, headphoneMat, glassFrameMat)

    function drawLabel(rig: Rig, member: OfficeMember, selected: boolean) {
      const key = `${member.shortName}|${member.phase}|${member.task}|${selected}`
      if (rig.lastLabel === key) return
      rig.lastLabel = key
      const g = rig.labelCanvas.getContext("2d")!
      g.clearRect(0, 0, 640, 176)

      g.fillStyle = selected ? "rgba(5, 150, 105, 0.96)" : "rgba(15, 22, 34, 0.92)"
      roundRect(g, 10, 10, 620, 156, 32)
      g.fill()
      g.strokeStyle = selected ? "#34D399" : "rgba(148, 163, 184, 0.28)"
      g.lineWidth = 4
      roundRect(g, 10, 10, 620, 156, 32)
      g.stroke()

      // Chấm trạng thái thật
      g.fillStyle = phaseColor(member.phase)
      g.beginPath()
      g.arc(52, 60, 14, 0, Math.PI * 2)
      g.fill()

      g.fillStyle = "#F8FAFC"
      g.font = "700 38px IBM Plex Sans, ui-sans-serif, sans-serif"
      g.textAlign = "left"
      g.textBaseline = "alphabetic"
      g.fillText(member.shortName, 82, 72)

      g.fillStyle = selected ? "#D1FAE5" : "#94A3B8"
      g.font = "600 24px IBM Plex Sans, ui-sans-serif, sans-serif"
      g.textAlign = "right"
      g.fillText(phaseLabel(member.phase), 604, 68)
      g.textAlign = "left"

      g.fillStyle = selected ? "#ECFDF5" : "#CBD5E1"
      g.font = "500 26px IBM Plex Sans, ui-sans-serif, sans-serif"
      const shortTask = member.task.length > 36 ? `${member.task.slice(0, 35)}…` : member.task
      g.fillText(shortTask, 42, 130)
      rig.labelTex.needsUpdate = true
    }

    function makeMat(color: string, roughness = 0.65, metalness = 0.02) {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
      mats.push(m)
      return m
    }

    function puff(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, parent: THREE.Object3D) {
      const mesh = addMesh(puffGeo, material, x, y, z, parent)
      mesh.scale.set(sx, sy, sz)
      return mesh
    }

    function buildPerson(member: OfficeMember): Rig {
      const look = member.look
      const seat = seatOf(member.desk)
      const group = new THREE.Group()
      group.position.set(seat.x, 0, seat.z)
      group.rotation.y = seat.rot
      group.userData.memberId = member.botId
      scene.add(group)

      const shirtMat = makeMat(look.shirt, 0.68, 0.04)
      const innerMat = makeMat(look.inner, 0.72, 0.02)
      const pantsMat = makeMat(look.pants, 0.78, 0.03)
      const skinMat = makeMat(look.skin, 0.48, 0.01)
      const hairMat = makeMat(look.hair, 0.62, 0.08)
      const irisMat = makeMat(look.eye, 0.25, 0.05)
      const packetMat = new THREE.MeshStandardMaterial({
        color: member.color,
        emissive: member.color,
        emissiveIntensity: 0.75,
        roughness: 0.3,
      })
      mats.push(packetMat)
      const owned: THREE.Material[] = [shirtMat, innerMat, pantsMat, skinMat, hairMat, irisMat, packetMat]

      // Thân chính (tỷ lệ người thật stylized, ngồi trên ghế cao y=0.80)
      const body = new THREE.Group()
      body.position.set(0, 0.8, 0)
      group.add(body)

      // Hông + Thân trên thon gọn
      addMesh(pelvisGeo, pantsMat, 0, -0.24, 0, body)
      const torso = addMesh(torsoGeo, shirtMat, 0, 0.06, 0, body)
      torso.scale.set(1.12, 1.0, 0.76)

      // Chi tiết trang phục theo phong cách thật (jacket / cardigan / hoodie / overshirt / sweater)
      if (look.outfit === "jacket" || look.outfit === "cardigan" || look.outfit === "overshirt") {
        // Áo lót phía trong (vùng ngực chữ V tinh tế)
        const inner = box(0.14, 0.34, 0.04, 0, 0.08, 0.132, innerMat, body, false)
        inner.scale.set(1, 1, 0.9)
        // Ve áo hai bên
        const lapelL = box(0.055, 0.26, 0.03, -0.085, 0.1, 0.14, shirtMat, body, false)
        const lapelR = box(0.055, 0.26, 0.03, 0.085, 0.1, 0.14, shirtMat, body, false)
        lapelL.rotation.z = 0.08
        lapelR.rotation.z = -0.08
      } else if (look.outfit === "hoodie") {
        // Cổ mũ hoodie + 2 dây rút tối giản
        const collar = addMesh(puffGeo, shirtMat, 0, 0.26, -0.06, body)
        collar.scale.set(0.88, 0.34, 0.72)
        box(0.012, 0.14, 0.012, -0.045, 0.14, 0.155, innerMat, body, false)
        box(0.012, 0.14, 0.012, 0.045, 0.14, 0.155, innerMat, body, false)
      } else {
        // Cổ tròn áo len
        const crew = addMesh(puffGeo, innerMat, 0, 0.27, 0.02, body)
        crew.scale.set(0.45, 0.14, 0.42)
      }

      // Cổ nối mượt đầu và thân
      addMesh(neckGeo, skinMat, 0, 0.33, 0.01, body)

      // Đầu tỷ lệ tự nhiên (oval gọn, không quá to)
      const head = new THREE.Group()
      head.position.set(0, 0.56, 0.02)
      body.add(head)
      const cranium = addMesh(headGeo, skinMat, 0, 0, 0, head)
      cranium.scale.set(0.86, 1.02, 0.88)

      // Tai hai bên
      const earL = addMesh(handGeo, skinMat, -0.2, -0.01, -0.01, head)
      const earR = addMesh(handGeo, skinMat, 0.2, -0.01, -0.01, head)
      earL.scale.set(0.35, 0.85, 0.42)
      earR.scale.set(0.35, 0.85, 0.42)

      // Tóc nhiều lớp tự nhiên
      if (look.style === "sidepart") {
        puff(hairMat, 0, 0.1, -0.02, 0.9, 0.74, 0.9, head)
        puff(hairMat, -0.06, 0.16, 0.08, 0.62, 0.28, 0.46, head)
        puff(hairMat, 0.12, 0.14, 0.06, 0.4, 0.22, 0.38, head)
        puff(hairMat, 0, 0.0, -0.14, 0.76, 0.58, 0.45, head)
      } else if (look.style === "bob") {
        puff(hairMat, 0, 0.1, -0.03, 0.96, 0.78, 0.94, head)
        puff(hairMat, -0.18, -0.04, -0.02, 0.38, 0.74, 0.58, head)
        puff(hairMat, 0.18, -0.04, -0.02, 0.38, 0.74, 0.58, head)
        puff(hairMat, 0, -0.04, -0.14, 0.82, 0.74, 0.44, head)
        puff(hairMat, -0.04, 0.14, 0.12, 0.66, 0.24, 0.32, head)
      } else if (look.style === "swept") {
        puff(hairMat, 0, 0.11, -0.03, 0.9, 0.7, 0.92, head)
        const crest = puff(hairMat, 0.04, 0.19, 0.06, 0.58, 0.3, 0.52, head)
        crest.rotation.z = -0.18
        puff(hairMat, 0, 0.02, -0.14, 0.74, 0.55, 0.42, head)
      } else if (look.style === "wavy") {
        puff(hairMat, 0, 0.1, -0.03, 0.95, 0.78, 0.94, head)
        puff(hairMat, -0.2, -0.08, -0.03, 0.36, 0.86, 0.52, head)
        puff(hairMat, 0.2, -0.08, -0.03, 0.36, 0.86, 0.52, head)
        puff(hairMat, 0, -0.1, -0.15, 0.84, 0.88, 0.44, head)
        puff(hairMat, 0.02, 0.15, 0.11, 0.62, 0.22, 0.32, head)
      } else {
        // layered
        puff(hairMat, 0, 0.11, -0.02, 0.92, 0.74, 0.92, head)
        puff(hairMat, -0.12, 0.14, 0.09, 0.48, 0.24, 0.38, head)
        puff(hairMat, 0.1, 0.15, 0.08, 0.44, 0.24, 0.38, head)
        puff(hairMat, 0, -0.02, -0.14, 0.78, 0.62, 0.45, head)
      }

      // Mắt tự nhiên + mí mắt có thể chớp (blinking)
      const makeEye = (ex: number) => {
        const white = addMesh(eyeWhiteGeo, eyeWhiteMat, ex, 0.02, 0.195, head, false)
        white.scale.set(1.15, 1.0, 0.5)
        const iris = addMesh(irisGeo, irisMat, ex, 0.018, 0.206, head, false)
        iris.scale.set(1.0, 1.0, 0.45)
        const pupil = addMesh(pupilGeo, pupilMat, ex, 0.018, 0.212, head, false)
        pupil.scale.set(1.0, 1.0, 0.4)
        addMesh(sparkGeo, sparkMat, ex - 0.008, 0.027, 0.216, head, false)

        const lid = addMesh(lidGeo, skinMat, ex, 0.044, 0.204, head, false)
        lid.scale.set(1, 0.28, 1)

        const brow = addMesh(browGeo, hairMat, ex, 0.085, 0.195, head, false)
        brow.rotation.z = Math.PI / 2 + (ex < 0 ? 0.08 : -0.08)
        return lid
      }
      const lidL = makeEye(-0.075)
      const lidR = makeEye(0.075)

      // Mũi & miệng tự nhiên
      const nose = addMesh(handGeo, skinMat, 0, -0.025, 0.215, head, false)
      nose.scale.set(0.32, 0.48, 0.42)
      const smile = addMesh(smileGeo, lipMat, 0, -0.088, 0.198, head, false)
      smile.rotation.z = Math.PI
      smile.scale.set(1.0, 0.55, 0.5)

      // Kính gọng kim loại mảnh
      if (look.glasses) {
        addMesh(glassGeo, glassFrameMat, -0.076, 0.02, 0.222, head, false)
        addMesh(glassGeo, glassFrameMat, 0.076, 0.02, 0.222, head, false)
        box(0.044, 0.009, 0.009, 0, 0.024, 0.222, glassFrameMat, head, false)
      }

      // Tai nghe studio chụp tai
      if (look.headphones) {
        const band = addMesh(headphoneBandGeo, headphoneMat, 0, 0.05, -0.01, head, false)
        band.scale.set(0.96, 1.05, 1)
        const cupL = addMesh(headphoneCupGeo, headphoneMat, -0.225, -0.005, -0.01, head)
        const cupR = addMesh(headphoneCupGeo, headphoneMat, 0.225, -0.005, -0.01, head)
        cupL.rotation.z = Math.PI / 2
        cupR.rotation.z = Math.PI / 2
      }

      // Cánh tay có khớp vai + khuỷu mượt
      function makeArm(side: number) {
        const shoulder = new THREE.Group()
        shoulder.position.set(side * 0.235, 0.21, 0.01)
        body.add(shoulder)
        addMesh(shoulderCapGeo, shirtMat, 0, 0, 0, shoulder)
        addMesh(upperArmGeo, shirtMat, 0, -0.13, 0, shoulder)

        const elbow = new THREE.Group()
        elbow.position.set(0, -0.25, 0)
        shoulder.add(elbow)
        const forearmMat = look.outfit === "overshirt" ? skinMat : shirtMat
        addMesh(foreArmGeo, forearmMat, 0, -0.12, 0, elbow)
        const hand = addMesh(handGeo, skinMat, 0, -0.24, 0.01, elbow)
        hand.scale.set(0.95, 1.15, 0.72)
        return { shoulder, elbow }
      }
      const leftArm = makeArm(-1)
      const rightArm = makeArm(1)

      // Gói dữ liệu A2A phát sáng cầm trên tay phải khi đi bàn giao việc
      const packet = addMesh(packetGeo, packetMat, 0, -0.24, 0.1, rightArm.elbow, false)
      packet.rotation.x = 0.4
      packet.visible = false

      // Chân có khớp hông + đầu gối thật (ngồi gập 90° tự nhiên trên ghế, đứng thẳng khi đi bộ)
      function makeLeg(side: number) {
        const hip = new THREE.Group()
        hip.position.set(side * 0.105, -0.28, 0.02)
        body.add(hip)
        addMesh(thighGeo, pantsMat, 0, -0.16, 0, hip)

        const knee = new THREE.Group()
        knee.position.set(0, -0.32, 0)
        hip.add(knee)
        addMesh(shinGeo, pantsMat, 0, -0.16, 0, knee)
        addMesh(shoeGeo, shoeMat, 0, -0.33, 0.05, knee)
        return { hip, knee }
      }
      const leftLeg = makeLeg(-1)
      const rightLeg = makeLeg(1)

      // Bảng tên nổi phía trên đầu (rõ nét, không che mặt)
      const paint = makeTexture(640, 176)
      const labelMat = new THREE.SpriteMaterial({ map: paint.tex, transparent: true, depthWrite: false })
      mats.push(labelMat)
      owned.push(labelMat)
      const sprite = new THREE.Sprite(labelMat)
      sprite.position.set(0, 1.14, 0)
      sprite.scale.set(2.45, 0.7, 1)
      sprite.center.set(0.5, 0)
      body.add(sprite)

      // Vòng chọn dưới sàn
      const ringMat = new THREE.MeshBasicMaterial({ color: member.color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      mats.push(ringMat)
      owned.push(ringMat)
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.set(0, 0.155, 0)
      ring.visible = false
      group.add(ring)

      let hash = 0
      for (let i = 0; i < member.botId.length; i += 1) hash = (hash * 31 + member.botId.charCodeAt(i)) % 1000

      return {
        id: member.botId,
        desk: member.desk,
        group,
        body,
        head,
        lidL,
        lidR,
        shoulderL: leftArm.shoulder,
        shoulderR: rightArm.shoulder,
        elbowL: leftArm.elbow,
        elbowR: rightArm.elbow,
        hipL: leftLeg.hip,
        hipR: rightLeg.hip,
        kneeL: leftLeg.knee,
        kneeR: rightLeg.knee,
        packet,
        ring,
        labelCanvas: paint.canvas,
        labelTex: paint.tex,
        owned,
        lastLabel: "",
        blinkSeed: (hash % 37) * 0.19,
      }
    }

    function disposeRig(rig: Rig) {
      scene.remove(rig.group)
      rig.labelTex.dispose()
      rig.owned.forEach((m) => m.dispose())
    }

    const deskLocal = new THREE.Vector3()
    function worldOnDesk(deskIndex: number, lx: number, lz: number) {
      const group = deskGroups[deskIndex] ?? deskGroups[0]
      deskLocal.set(lx, 0, lz)
      group.localToWorld(deskLocal)
      return { x: deskLocal.x, z: deskLocal.z }
    }
    function seatOf(deskIndex: number) {
      const seat = seatAnchors[deskIndex] ?? seatAnchors[0]
      seat.getWorldPosition(deskLocal)
      return { x: deskLocal.x, z: deskLocal.z, rot: DESK_YAW }
    }
    function smoothstep(value: number) {
      const t = Math.min(1, Math.max(0, value))
      return t * t * (3 - 2 * t)
    }

    let staffKey = ""
    let boardKey = ""
    let lastFocusId: string | null = null
    let lastResetSeq = 0
    let cameraLerping = false

    const timer = new THREE.Timer()
    timer.connect(document)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0
    let downY = 0
    let dragged = false

    function resize() {
      const width = view.clientWidth || 1
      const height = view.clientHeight || 1
      const aspect = width / height
      const frustum = 20.5
      camera.left = (-frustum * aspect) / 2
      camera.right = (frustum * aspect) / 2
      camera.top = frustum / 2
      camera.bottom = -frustum / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(view)
    resize()

    function onPointerDown(e: PointerEvent) {
      downX = e.clientX
      downY = e.clientY
      dragged = false
      cameraLerping = false
    }
    function onPointerMove(e: PointerEvent) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) dragged = true
    }
    function onPointerUp(e: PointerEvent) {
      if (dragged) return
      const rect = view.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(rigs.map((r) => r.group), true)
      const hit = hits.find((item) => {
        let node: THREE.Object3D | null = item.object
        while (node) {
          if (typeof node.userData.memberId === "string") return true
          node = node.parent
        }
        return false
      })
      if (!hit) return
      let node: THREE.Object3D | null = hit.object
      while (node && typeof node.userData.memberId !== "string") node = node.parent
      if (node && typeof node.userData.memberId === "string") onSelect(node.userData.memberId)
    }
    view.addEventListener("pointerdown", onPointerDown)
    view.addEventListener("pointermove", onPointerMove)
    view.addEventListener("pointerup", onPointerUp)

    let frame = 0
    const loop = () => {
      frame = requestAnimationFrame(loop)
      const snap = snapshotRef.current
      if (!snap) return
      timer.update()
      const elapsed = timer.getElapsed()
      const { members, state } = snap

      // Đồng bộ danh sách nhân vật khi có bot mới từ A2A
      const nextStaffKey = members.map((m) => `${m.botId}:${m.desk}:${m.color}`).join("|")
      if (nextStaffKey !== staffKey) {
        staffKey = nextStaffKey
        rigs.forEach(disposeRig)
        rigs.length = 0
        members.forEach((m) => rigs.push(buildPerson(m)))
      }

      // Hiển thị số bàn phù hợp (tối thiểu 6 bàn, tự mở rộng tới 12 bàn theo số lượng agent)
      const visibleDesks = Math.min(DESKS.length, Math.max(6, Math.ceil(members.length / 2) * 2))
      deskGroups.forEach((g, idx) => {
        g.visible = idx < visibleDesks
      })

      // Nhịp ánh sáng Hub trung tâm
      hubRingMat.opacity = 0.35 + Math.sin(elapsed * 2.2) * 0.15

      // Cập nhật bảng tường khi dữ liệu thật thay đổi
      const nextBoardKey = `${snap.liveOk}|${snap.a2a?.queued ?? 0}|${snap.a2a?.inFlight ?? 0}|${snap.a2a?.acked ?? 0}|${snap.a2a?.failed ?? 0}|${members
        .map((m) => `${m.botId}:${m.phase}:${m.task}`)
        .join("|")}`
      if (nextBoardKey !== boardKey) {
        boardKey = nextBoardKey
        drawBoard(snap)
      }

      // Smooth camera focus khi người dùng chọn 1 agent hoặc bấm Reset góc nhìn
      if (state.cameraResetSeq !== lastResetSeq) {
        lastResetSeq = state.cameraResetSeq
        desiredTarget.copy(defaultTarget)
        cameraLerping = true
      } else if (state.focusId !== lastFocusId) {
        lastFocusId = state.focusId
        if (state.focusId) {
          const targetMember = members.find((m) => m.botId === state.focusId)
          if (targetMember) {
            const pos = seatOf(targetMember.desk)
            desiredTarget.set(pos.x, 1.0, pos.z)
            cameraLerping = true
          }
        }
      }
      if (cameraLerping) {
        controls.target.lerp(desiredTarget, 0.1)
        if (controls.target.distanceTo(desiredTarget) < 0.03) {
          controls.target.copy(desiredTarget)
          cameraLerping = false
        }
      }

      // Animate từng nhân vật theo đúng trạng thái A2A thật
      members.forEach((member, idx) => {
        const rig = rigs[idx]
        if (!rig) return
        const selected = state.selectedId === member.botId
        drawLabel(rig, member, selected)
        rig.ring.visible = selected

        const home = seatOf(rig.desk)
        const phaseOffset = idx * 1.37
        let x = home.x
        let z = home.z
        let rot = home.rot
        let pose: "sit" | "walk" | "handoff" = "sit"

        const trip = state.trips.find((t) => t.fromId === rig.id && t.progress < 1)
        if (trip) {
          const dest = worldOnDesk(trip.destDesk, idx % 2 === 0 ? 0.95 : -0.95, -0.55)
          if (trip.progress < 0.42) {
            const along = smoothstep(trip.progress / 0.42)
            x = home.x + (dest.x - home.x) * along
            z = home.z + (dest.z - home.z) * along
            rot = Math.atan2(dest.x - home.x, dest.z - home.z)
            pose = "walk"
          } else if (trip.progress < 0.64) {
            x = dest.x
            z = dest.z
            const partnerSeat = seatOf(trip.destDesk)
            rot = Math.atan2(partnerSeat.x - dest.x, partnerSeat.z - dest.z)
            pose = "handoff"
          } else {
            const along = smoothstep((trip.progress - 0.64) / 0.36)
            x = dest.x + (home.x - dest.x) * along
            z = dest.z + (home.z - dest.z) * along
            rot = Math.atan2(home.x - dest.x, home.z - dest.z)
            pose = "walk"
          }
        }

        rig.group.position.x = x
        rig.group.position.z = z
        rig.group.rotation.y = rot
        rig.packet.visible = pose === "walk" || pose === "handoff"

        // Chớp mắt tự nhiên theo chu kỳ 3.8 giây
        const blinkCycle = (elapsed + rig.blinkSeed) % 3.8
        const blinking = blinkCycle > 3.66
        const lidScaleY = member.phase === "offline" ? 1.15 : blinking ? 1.25 : 0.28
        rig.lidL.scale.y = lidScaleY
        rig.lidR.scale.y = lidScaleY

        if (pose === "walk") {
          const stride = elapsed * 7.5 + phaseOffset
          rig.body.position.y = 1.04 + Math.abs(Math.sin(stride)) * 0.045
          rig.hipL.rotation.x = Math.sin(stride) * 0.55
          rig.hipR.rotation.x = Math.sin(stride + Math.PI) * 0.55
          rig.kneeL.rotation.x = Math.max(0, -Math.sin(stride) * 0.45)
          rig.kneeR.rotation.x = Math.max(0, -Math.sin(stride + Math.PI) * 0.45)
          rig.shoulderL.rotation.x = Math.sin(stride + Math.PI) * 0.42
          rig.elbowL.rotation.x = -0.35
          rig.shoulderR.rotation.x = -0.55
          rig.elbowR.rotation.x = -0.65
          rig.head.rotation.set(0.03, Math.sin(stride * 0.5) * 0.06, 0)
        } else if (pose === "handoff") {
          rig.body.position.y = 1.04 + Math.sin(elapsed * 2.5 + phaseOffset) * 0.015
          rig.hipL.rotation.x = 0
          rig.hipR.rotation.x = 0
          rig.kneeL.rotation.x = 0
          rig.kneeR.rotation.x = 0
          rig.shoulderL.rotation.x = -0.25 + Math.sin(elapsed * 3.2) * 0.1
          rig.elbowL.rotation.x = -0.55
          rig.shoulderR.rotation.x = -0.95 + Math.sin(elapsed * 4.0) * 0.12
          rig.elbowR.rotation.x = -0.45
          rig.head.rotation.set(0.06, Math.sin(elapsed * 2.2) * 0.15, 0)
        } else {
          // Ngồi đúng tư thế công thái học trên ghế (đùi ngang -1.42, cẳng chân vuông góc +1.38)
          const active = member.phase === "working" || member.phase === "queued"
          const breath = Math.sin(elapsed * 1.8 + phaseOffset) * 0.01
          rig.body.position.y = 0.8 + breath
          rig.hipL.rotation.x = -1.42
          rig.hipR.rotation.x = -1.42
          rig.kneeL.rotation.x = 1.38
          rig.kneeR.rotation.x = 1.38

          if (active) {
            const typeFreq = member.phase === "working" ? 11.5 : 6.0
            const typeSwing = Math.sin(elapsed * typeFreq + phaseOffset) * 0.14
            rig.shoulderL.rotation.x = -0.55
            rig.shoulderR.rotation.x = -0.55
            rig.elbowL.rotation.x = -0.92 + typeSwing
            rig.elbowR.rotation.x = -0.92 - typeSwing * 0.9
            rig.head.rotation.set(0.12, Math.sin(elapsed * 0.9 + phaseOffset) * 0.09, 0)
          } else if (member.phase === "offline") {
            rig.shoulderL.rotation.x = -0.15
            rig.shoulderR.rotation.x = -0.15
            rig.elbowL.rotation.x = -0.45
            rig.elbowR.rotation.x = -0.45
            rig.head.rotation.set(0.24, 0, 0.04)
          } else {
            // idle / error: thư giãn, nhìn qua lại quan sát phòng
            rig.shoulderL.rotation.x = -0.32
            rig.shoulderR.rotation.x = -0.38
            rig.elbowL.rotation.x = -0.78
            rig.elbowR.rotation.x = -0.82 + Math.sin(elapsed * 1.4 + phaseOffset) * 0.06
            rig.head.rotation.set(0.05, Math.sin(elapsed * 0.55 + phaseOffset) * 0.24, 0)
          }
        }
      })

      // Cập nhật toàn bộ màn hình bàn làm việc
      const cursorOn = Math.floor(elapsed * 2) % 2 === 0
      screenViews.forEach((sv, idx) => {
        if (idx >= visibleDesks) return
        const occupant = members.find((m) => m.desk === idx) ?? null
        drawScreen(sv, occupant, cursorOn)
      })

      controls.update()
      renderer.render(scene, camera)
    }

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else if (!frame) {
        timer.update()
        frame = requestAnimationFrame(loop)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    if (!document.hidden) loop()

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", onVisibility)
      resizeObserver.disconnect()
      view.removeEventListener("pointerdown", onPointerDown)
      view.removeEventListener("pointermove", onPointerMove)
      view.removeEventListener("pointerup", onPointerUp)
      rigs.forEach(disposeRig)
      controls.dispose()
      timer.dispose()
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
      floorTex.dispose()
      screenViews.forEach((sv) => sv.tex.dispose())
      signPaint.tex.dispose()
      boardPaint.tex.dispose()
      renderer.dispose()
    }
  }, [onSelect, snapshotRef])

  return <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" />
}
