import type { DemoSourceId } from './types';

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

function koi(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const bg = g.createRadialGradient(w * 0.48, h * 0.4, 0, w * 0.48, h * 0.4, w * 0.75);
  bg.addColorStop(0, '#123e55');
  bg.addColorStop(0.5, '#071c32');
  bg.addColorStop(1, '#020914');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i++) {
    const y = h * (0.12 + i * 0.095);
    g.beginPath();
    for (let x = -20; x <= w + 20; x += 12) {
      const py = y + Math.sin(x * 0.018 + t * 0.7 + i * 0.9) * 6;
      x === -20 ? g.moveTo(x, py) : g.lineTo(x, py);
    }
    g.strokeStyle = `rgba(64, 199, 218, ${0.035 + (i % 3) * 0.012})`;
    g.lineWidth = 3;
    g.stroke();
  }
  g.restore();

  const fish = (offset: number, scale: number, rose: boolean) => {
    const phase = t * (0.42 + offset * 0.03) + offset;
    const cx = w * 0.5 + Math.cos(phase) * w * (0.22 + offset * 0.015);
    const cy = h * 0.5 + Math.sin(phase * 1.35) * h * 0.23;
    const dx = -Math.sin(phase);
    const dy = Math.cos(phase) * 0.72;
    const angle = Math.atan2(dy, dx);
    const tail = Math.sin(t * 5.1 + offset * 2.7) * 0.22;

    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.scale(scale, scale);
    g.shadowColor = rose ? '#ff547f' : '#4ce4f0';
    g.shadowBlur = 24;

    g.save();
    g.translate(-50, 0);
    g.rotate(tail);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-36, -38, -52, -27);
    g.quadraticCurveTo(-42, 0, -53, 28);
    g.quadraticCurveTo(-27, 35, 0, 0);
    g.fillStyle = rose ? 'rgba(255,76,120,.82)' : 'rgba(68,211,224,.8)';
    g.fill();
    g.restore();

    const body = g.createLinearGradient(-45, -20, 54, 22);
    body.addColorStop(0, rose ? '#ff4d77' : '#38d3e0');
    body.addColorStop(0.48, '#f7e9d1');
    body.addColorStop(1, rose ? '#ff9a6f' : '#8bf3e9');
    g.beginPath();
    g.moveTo(-45, 0);
    g.bezierCurveTo(-30, -28, 25, -34, 55, 0);
    g.bezierCurveTo(25, 34, -30, 28, -45, 0);
    g.fillStyle = body;
    g.fill();
    ellipse(g, 35, -8, 3.2, 3.2, '#071019');
    g.restore();
  };
  fish(0.4, Math.max(0.68, w / 1050), true);
  fish(3.0, Math.max(0.5, w / 1350), false);
}

function cloud(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#344b64');
  sky.addColorStop(0.5, '#75838e');
  sky.addColorStop(1, '#484955');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  const sun = g.createRadialGradient(w * 0.74, h * 0.26, 0, w * 0.74, h * 0.26, h * 0.45);
  sun.addColorStop(0, 'rgba(255,231,186,.32)');
  sun.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);

  const bank = (baseY: number, speed: number, alpha: number, dark: boolean, seed: number) => {
    const drift = ((t * speed * w + seed * 137) % (w * 1.5)) - w * 0.25;
    g.save();
    g.filter = `blur(${Math.max(3, w / 260)}px)`;
    g.globalAlpha = alpha;
    g.shadowColor = dark ? '#252936' : '#66717d';
    g.shadowBlur = Math.max(10, w / 70);
    for (let i = -2; i < 9; i++) {
      const x = ((drift + i * w * 0.19) % (w * 1.5)) - w * 0.25;
      const bob = Math.sin(t * 0.22 + i * 1.8 + seed) * h * 0.025;
      const r = w * (0.09 + (i % 3) * 0.015);
      ellipse(g, x, baseY + bob, r, r * (0.48 + (i % 2) * 0.1), dark ? '#3e4352' : '#aab1b4');
    }
    g.restore();
  };
  bank(h * 0.76, 0.018, 0.94, true, 2);
  bank(h * 0.56, 0.027, 0.67, false, 4);
  bank(h * 0.3, 0.012, 0.38, false, 7);

  const haze = g.createLinearGradient(0, h * 0.45, 0, h);
  haze.addColorStop(0, 'rgba(235,220,205,0)');
  haze.addColorStop(1, 'rgba(233,192,157,.22)');
  g.fillStyle = haze;
  g.fillRect(0, 0, w, h);
}

function flower(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const bg = g.createRadialGradient(w * 0.5, h * 0.54, 0, w * 0.5, h * 0.54, w * 0.72);
  bg.addColorStop(0, '#273b38');
  bg.addColorStop(0.55, '#101d22');
  bg.addColorStop(1, '#05090e');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  const bloom = 0.78 + Math.sin(t * 0.55) * 0.14;
  const cx = w * 0.5 + Math.sin(t * 0.16) * w * 0.02;
  const cy = h * 0.48 + Math.cos(t * 0.2) * h * 0.015;
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.sin(t * 0.18) * 0.04);
  g.globalCompositeOperation = 'screen';
  g.shadowColor = '#ff7895';
  g.shadowBlur = Math.max(20, w / 30);
  const petals = 14;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + t * 0.025;
    const r = Math.min(w, h) * (0.19 + (i % 2) * 0.035) * bloom;
    g.save();
    g.rotate(a);
    g.translate(r * 0.56, 0);
    g.rotate(Math.sin(t * 0.7 + i) * 0.035);
    const petal = g.createLinearGradient(0, -r * 0.15, r, r * 0.16);
    petal.addColorStop(0, 'rgba(255,189,183,.82)');
    petal.addColorStop(0.65, i % 2 ? 'rgba(227,73,120,.68)' : 'rgba(255,112,139,.72)');
    petal.addColorStop(1, 'rgba(91,32,90,.12)');
    g.beginPath();
    g.ellipse(r * 0.38, 0, r * 0.48, r * 0.15 * bloom, 0, 0, Math.PI * 2);
    g.fillStyle = petal;
    g.fill();
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';
  const heart = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.09);
  heart.addColorStop(0, '#fff4b8');
  heart.addColorStop(0.35, '#ef9e57');
  heart.addColorStop(1, '#55203c');
  ellipse(g, 0, 0, h * 0.075, h * 0.075, heart);
  g.restore();

  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 18; i++) {
    const x = ((i * 137 + t * (4 + i % 4)) % (w + 80)) - 40;
    const y = h - ((i * 83 + t * (10 + i % 5)) % (h * 0.85));
    ellipse(g, x, y, 1.2 + (i % 3), 1.2 + (i % 3), `rgba(255,196,137,${0.08 + (i % 4) * 0.035})`);
  }
  g.globalCompositeOperation = 'source-over';
}

const PAINTERS: Record<DemoSourceId, Painter> = {
  'living-koi': koi,
  'drifting-cloud': cloud,
  'blooming-flower': flower,
};

export function paintDemoSource(
  sourceId: DemoSourceId,
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  g.save();
  g.clearRect(0, 0, w, h);
  PAINTERS[sourceId](g, w, h, time);
  g.restore();
}
