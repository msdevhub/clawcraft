import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text, TextStyle, FederatedPointerEvent } from 'pixi.js';
import { useWorldStore } from '@/store/world-store';
import { soundManager } from '@/audio/sound-manager';
import type { AgentState, EntityType, SessionState, KingdomBuilding } from '@/store/types';

const GRID_UNIT = 28;
const GRID_SPACING = 3.5;
const BUILDING_RADIUS = 0;
const BUILDING_W = GRID_UNIT * 3;
const BUILDING_H = GRID_UNIT * 2;
const GATEWAY_W = GRID_UNIT * 3;
const GATEWAY_H = GRID_UNIT * 3;
const AGENT_W = GRID_UNIT * 2;
const AGENT_H = GRID_UNIT * 2;
const SESSION_W = GRID_UNIT;
const SESSION_H = GRID_UNIT;
const BUILDING_BADGE_SIZE = 18;
const VIGNETTE_SIZE = 72;
const DRAG_CLICK_THRESHOLD = 5;

function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

const AGENT_COLORS = [0x3b82f6, 0x8b5cf6, 0xf59e0b, 0x10b981, 0xef4444, 0xec4899];
const STATUS_COLORS: Record<string, number> = {
  idle: 0x64748b,
  thinking: 0x3b82f6,
  tooling: 0xf59e0b,
  responding: 0x10b981,
  blocked: 0xef4444,
  ended: 0x374151,
  online: 0x10b981,
  offline: 0xef4444,
  running: 0x10b981,
  stopping: 0xf59e0b,
  unknown: 0x64748b,
};

function drawGroundGrid(g: Graphics, viewportWidth: number, viewportHeight: number, worldX: number, worldY: number, scale: number) {
  g.clear();

  const s = Math.max(scale, 0.1);
  // Convert viewport bounds to world coordinates (accounting for zoom)
  const margin = GRID_UNIT * 2;
  const worldLeft = -worldX / s - margin;
  const worldTop = -worldY / s - margin;
  const worldRight = -worldX / s + viewportWidth / s + margin;
  const worldBottom = -worldY / s + viewportHeight / s + margin;

  // Snap to grid
  const startCol = Math.floor(worldLeft / GRID_UNIT);
  const endCol = Math.ceil(worldRight / GRID_UNIT);
  const startRow = Math.floor(worldTop / GRID_UNIT);
  const endRow = Math.ceil(worldBottom / GRID_UNIT);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const x = col * GRID_UNIT;
      const y = row * GRID_UNIT;
      const isDark = (Math.abs(row) + Math.abs(col)) % 2 === 0;

      g.rect(x, y, GRID_UNIT, GRID_UNIT);
      g.fill({ color: isDark ? 0x0f172a : 0x111827, alpha: isDark ? 0.34 : 0.24 });
      g.rect(x, y, GRID_UNIT, GRID_UNIT);
      g.stroke({ color: 0x1e293b, alpha: 0.32, width: 1 });
    }
  }
}

function drawViewportVignette(g: Graphics, viewportWidth: number, viewportHeight: number) {
  g.clear();

  const steps = 28;
  const color = 0x0a0f1a;
  const horizontalStep = VIGNETTE_SIZE / steps;
  const verticalStep = VIGNETTE_SIZE / steps;

  for (let i = 0; i < steps; i++) {
    const progress = i / steps;
    const alpha = 0.6 * Math.pow(1 - progress, 1.6);

    g.rect(i * horizontalStep, 0, horizontalStep + 1, viewportHeight);
    g.fill({ color, alpha });

    g.rect(viewportWidth - (i + 1) * horizontalStep, 0, horizontalStep + 1, viewportHeight);
    g.fill({ color, alpha });

    g.rect(0, i * verticalStep, viewportWidth, verticalStep + 1);
    g.fill({ color, alpha });

    g.rect(0, viewportHeight - (i + 1) * verticalStep, viewportWidth, verticalStep + 1);
    g.fill({ color, alpha });
  }
}

interface BuildingStyle {
  fill: number;
}

const BUILDING_STYLES: Record<string, BuildingStyle> = {
  channel: { fill: 0x38bdf8 },
  skill: { fill: 0xfbbf24 },
  plugin: { fill: 0xa78bfa },
  memory: { fill: 0xf472b6 },
  model: { fill: 0xfb7185 },
  files: { fill: 0xa3e635 },
  tools: { fill: 0x818cf8 },
  cron: { fill: 0x60a5fa },
};

const BUILDING_COLORS: Record<string, number> = {
  channel: BUILDING_STYLES.channel.fill,
  skill: BUILDING_STYLES.skill.fill,
  plugin: BUILDING_STYLES.plugin.fill,
  memory: BUILDING_STYLES.memory.fill,
  model: BUILDING_STYLES.model.fill,
  files: BUILDING_STYLES.files.fill,
  tools: BUILDING_STYLES.tools.fill,
  cron: BUILDING_STYLES.cron.fill,
};

const BUILDING_ERROR_STATUS = /error|disconnect|blocked|failed|degraded|offline|stopped|timeout/i;

interface SmokeSeed {
  drift: number;
  phase: number;
  size: number;
  speed: number;
  xOffset: number;
}

function hasProblemText(value?: string) {
  return BUILDING_ERROR_STATUS.test(value ?? '');
}

function buildingHasErrors(building: KingdomBuilding) {
  return building.items.some((item) => hasProblemText(item.status) || hasProblemText(item.detail) || hasProblemText(item.name));
}

function createSmokeSeeds(): SmokeSeed[] {
  return Array.from({ length: 6 }, (_, idx) => ({
    drift: 2 + Math.random() * 4,
    phase: idx * 0.19 + Math.random() * 0.5,
    size: 4 + Math.random() * 4,
    speed: 0.0035 + Math.random() * 0.003,
    xOffset: -10 + idx * 4 + (Math.random() - 0.5) * 6,
  }));
}

function elasticOut(t: number) {
  if (t === 0 || t === 1) {
    return t;
  }

  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function snapToGrid(value: number, cellSpan = 1) {
  // For odd-cell-span entities (e.g. 3-wide building), offset by half a grid unit
  // so edges align with the background grid lines
  const offset = (cellSpan % 2 !== 0) ? GRID_UNIT / 2 : 0;
  return Math.round((value - offset) / GRID_UNIT) * GRID_UNIT + offset;
}

// Snap helpers per entity type
function snapGateway(x: number, y: number): [number, number] {
  return [snapToGrid(x, GATEWAY_W / GRID_UNIT), snapToGrid(y, GATEWAY_H / GRID_UNIT)];
}
function snapAgent(x: number, y: number): [number, number] {
  return [snapToGrid(x, AGENT_W / GRID_UNIT), snapToGrid(y, AGENT_H / GRID_UNIT)];
}
function snapBuilding(x: number, y: number): [number, number] {
  return [snapToGrid(x, BUILDING_W / GRID_UNIT), snapToGrid(y, BUILDING_H / GRID_UNIT)];
}
function snapSession(x: number, y: number): [number, number] {
  return [snapToGrid(x, SESSION_W / GRID_UNIT), snapToGrid(y, SESSION_H / GRID_UNIT)];
}
function snapEntity(x: number, y: number, entityType: EntityType, entityKey: string): [number, number] {
  if (entityKey === 'gateway') return snapGateway(x, y);
  if (entityType === 'agent') return snapAgent(x, y);
  if (entityType === 'building') return snapBuilding(x, y);
  return snapSession(x, y);
}

function drawInternalGridLines(g: Graphics, width: number, height: number, alpha = 0.15) {
  const halfW = width / 2;
  const halfH = height / 2;
  const widthInCells = Math.round(width / GRID_UNIT);
  const heightInCells = Math.round(height / GRID_UNIT);

  for (let gx = 1; gx < widthInCells; gx++) {
    const x = -halfW + gx * GRID_UNIT;
    g.moveTo(x, -halfH);
    g.lineTo(x, halfH);
  }

  for (let gy = 1; gy < heightInCells; gy++) {
    const y = -halfH + gy * GRID_UNIT;
    g.moveTo(-halfW, y);
    g.lineTo(halfW, y);
  }

  if (widthInCells > 1 || heightInCells > 1) {
    g.stroke({ color: 0x000000, alpha, width: 1 });
  }
}

function drawBlockShadow(g: Graphics, width: number, height: number, offsetX: number, offsetY: number, alpha: number) {
  g.clear();
  g.rect(-(width / 2) + offsetX, -(height / 2) + offsetY, width, height);
  g.fill({ color: 0x000000, alpha });
}

function drawBlock(
  g: Graphics,
  width: number,
  height: number,
  fillColor: number,
  fillAlpha: number,
  strokeColor: number,
  strokeAlpha: number,
  strokeWidth: number,
  gridAlpha = 0,
) {
  g.clear();
  g.rect(-(width / 2), -(height / 2), width, height);
  g.fill({ color: fillColor, alpha: fillAlpha });
  if (gridAlpha > 0) {
    drawInternalGridLines(g, width, height, gridAlpha);
  }
  g.rect(-(width / 2), -(height / 2), width, height);
  g.stroke({ color: strokeColor, alpha: strokeAlpha, width: strokeWidth });
}

function getBuildingBadgePosition() {
  return {
    x: BUILDING_W / 2 - BUILDING_BADGE_SIZE / 2 - 4,
    y: -(BUILDING_H / 2 - BUILDING_BADGE_SIZE / 2 - 4),
  };
}

function drawBuildingBadge(g: Graphics, color: number) {
  const { x, y } = getBuildingBadgePosition();
  const half = BUILDING_BADGE_SIZE / 2;

  g.clear();
  g.rect(x - half, y - half, BUILDING_BADGE_SIZE, BUILDING_BADGE_SIZE);
  g.fill({ color: 0x1e293b, alpha: 0.9 });
  g.rect(x - half, y - half, BUILDING_BADGE_SIZE, BUILDING_BADGE_SIZE);
  g.stroke({ color, width: 1.5 });
}

function drawBuildingAlert(g: Graphics, building: KingdomBuilding, smokeSeeds: SmokeSeed[], elapsed: number) {
  const pulse = 0.55 + (Math.sin(Date.now() / 220 + elapsed * 0.04) + 1) * 0.2;
  const halfW = BUILDING_W / 2;
  const halfH = BUILDING_H / 2;

  g.clear();

  g.rect(-(halfW + 3), -(halfH + 3), BUILDING_W + 6, BUILDING_H + 6);
  g.fill({ color: 0xff6b6b, alpha: 0.14 + pulse * 0.08 });

  g.rect(-(halfW + 6), -(halfH + 6), BUILDING_W + 12, BUILDING_H + 12);
  g.stroke({ color: 0xff3b30, alpha: 0.35 + pulse * 0.18, width: 2 });

  g.rect(-(halfW + 10), -(halfH + 10), BUILDING_W + 20, BUILDING_H + 20);
  g.stroke({ color: 0x7f1d1d, alpha: 0.18 + pulse * 0.12, width: 4 });

  smokeSeeds.forEach((seed) => {
    const progress = (elapsed * seed.speed + seed.phase) % 1;
    const x = seed.xOffset + Math.sin(progress * Math.PI * 2 + seed.phase) * seed.drift;
    const y = -(halfH + 8) - progress * 42;
    const size = seed.size * (1 - progress * 0.35);
    const alpha = (1 - progress) * (0.18 + pulse * 0.16);

    g.circle(x, y, size);
    g.fill({ color: 0x050505, alpha });
  });

  const accentColor = BUILDING_STYLES[building.type]?.fill ?? 0x64748b;
  g.rect(-halfW, -halfH, BUILDING_W, BUILDING_H);
  g.stroke({ color: accentColor, alpha: 0.16 + pulse * 0.08, width: 1.5 });
}

function createGatewayEntity(): Container {
  const c = new Container();
  c.label = 'gateway';

  // Drop shadow
  const shadow = new Graphics();
  drawBlockShadow(shadow, GATEWAY_W, GATEWAY_H, 3, 4, 0.22);
  c.addChild(shadow);

  const g = new Graphics();
  drawBlock(g, GATEWAY_W, GATEWAY_H, 0x047857, 0.92, 0x6ee7b7, 0.6, 2.5, 0.13);
  c.addChild(g);

  const icon = new Text({
    text: '🏰',
    style: new TextStyle({ fontSize: 34, fill: 0xffffff, fontFamily: 'monospace' }),
  });
  icon.anchor.set(0.5);
  icon.label = '__gateway_icon';
  c.addChild(icon);

  const label = new Text({
    text: 'Gateway',
    style: new TextStyle({ fontSize: 12, fill: 0xffffff, fontFamily: 'monospace' }),
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, GATEWAY_H / 2 + 12);
  label.label = '__gateway_name';
  c.addChild(label);

  return c;
}

function createAgentEntity(agent: AgentState, colorIndex: number): Container {
  const c = new Container();
  c.label = `agent:${agent.agentId}`;
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length];

  const g = new Graphics();
  drawBlock(g, AGENT_W, AGENT_H, color, 0.9, darken(color, 0.55), 0.9, 2, 0.12);
  c.addChild(g);

  const label = new Text({
    text: agent.name,
    style: new TextStyle({ fontSize: 11, fill: 0xffffff, fontFamily: 'monospace' }),
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, AGENT_H / 2 + 8);
  label.label = '__agent_name';
  c.addChild(label);

  return c;
}

function createSessionEntity(session: SessionState, agentColor: number): Container {
  const c = new Container();
  c.label = `session:${session.sessionKey}`;
  const g = new Graphics();
  const statusColor = STATUS_COLORS[session.status] ?? 0x64748b;
  drawBlock(g, SESSION_W, SESSION_H, agentColor, 0.7, statusColor, 1, 2);
  c.addChild(g);

  const ring = new Graphics();
  ring.label = '__birth_ring';
  c.addChild(ring);

  return c;
}

function createBuildingEntity(building: KingdomBuilding): Container {
  const c = new Container();
  c.label = `building:${building.id}`;
  const fillColor = BUILDING_STYLES[building.type]?.fill ?? 0x64748b;
  const badgeColor = BUILDING_COLORS[building.type] ?? 0x64748b;

  // Drop shadow
  const shadow = new Graphics();
  shadow.label = '__building_shadow';
  drawBlockShadow(shadow, BUILDING_W, BUILDING_H, 3, 4, 0.25);
  c.addChild(shadow);

  const g = new Graphics();
  g.label = '__building_base';
  drawBlock(g, BUILDING_W, BUILDING_H, fillColor, 0.9, 0xffffff, 0.16, 1.5, 0.15);
  c.addChild(g);

  const errorFx = new Graphics();
  errorFx.label = '__error_fx';
  c.addChild(errorFx);

  const icon = new Text({
    text: building.icon,
    style: new TextStyle({ fontSize: 30, fill: 0xffffff, fontFamily: 'monospace' }),
  });
  icon.anchor.set(0.5);
  icon.label = '__building_icon';
  c.addChild(icon);

  const label = new Text({
    text: building.name,
    style: new TextStyle({ fontSize: 10, fill: 0xffffff, fontFamily: 'monospace' }),
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, BUILDING_H / 2 + 10);
  label.label = '__building_name';
  c.addChild(label);

  if (building.count > 0) {
    const badge = new Graphics();
    drawBuildingBadge(badge, badgeColor);
    badge.label = '__count_badge';
    c.addChild(badge);

    const badgePosition = getBuildingBadgePosition();
    const countText = new Text({
      text: `${building.count}`,
      style: new TextStyle({ fontSize: 9, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' }),
    });
    countText.anchor.set(0.5);
    countText.position.set(badgePosition.x, badgePosition.y);
    countText.label = '__count_text';
    c.addChild(countText);
  }

  return c;
}

type SelectionShape = { kind: 'roundRect'; width: number; height: number; radius: number };

function getSelectionShape(target: string): SelectionShape {
  if (target === 'gateway') {
    return { kind: 'roundRect', width: 92, height: 92, radius: 0 };
  }

  if (target.startsWith('building:')) {
    return {
      kind: 'roundRect',
      width: BUILDING_W + 12,
      height: BUILDING_H + 12,
      radius: BUILDING_RADIUS,
    };
  }

  if (target.startsWith('agent:')) {
    return { kind: 'roundRect', width: 64, height: 64, radius: 0 };
  }

  return { kind: 'roundRect', width: 36, height: 36, radius: 0 };
}

function drawSelectionRing(g: Graphics, shape: SelectionShape, isSelected: boolean) {
  const color = isSelected ? 0x22c55e : 0xffffff;
  const alpha = isSelected ? 0.7 : 0.4;

  g.rect(-(shape.width / 2), -(shape.height / 2), shape.width, shape.height);
  g.stroke({ color, alpha, width: isSelected ? 2 : 1.5 });
  if (isSelected) {
    g.rect(-(shape.width / 2) - 4, -(shape.height / 2) - 4, shape.width + 8, shape.height + 8);
    g.stroke({ color, alpha: alpha * 0.35, width: 1 });
  }
}

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  alpha: number;
}

function createAmbientParticles(count: number, w: number, h: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: (Math.random() - 0.5) * w * 2,
      y: (Math.random() - 0.5) * h * 2,
      size: Math.random() * 1.5 + 0.5,
      speed: Math.random() * 0.15 + 0.05,
      alpha: Math.random() * 0.4 + 0.1,
    });
  }
  return particles;
}

function drawAmbientParticles(g: Graphics, particles: Particle[], elapsed: number) {
  g.clear();
  for (const p of particles) {
    const flicker = p.alpha + Math.sin(elapsed * p.speed + p.x) * 0.15;
    g.circle(p.x, p.y + Math.sin(elapsed * 0.01 + p.x * 0.01) * 3, p.size);
    g.fill({ color: 0x94a3b8, alpha: Math.max(0.05, flicker) });
  }
}

// ============ Manual Walls (Brick Grid) ============

interface WallBrick {
  col: number; row: number;
}

const BRICK_SIZE = 28;
// Earthy palette
const WALL_BASE   = 0x9E7B4A; // warm stone
const WALL_MORTAR = 0x6B5233; // mortar line
const WALL_LIGHT  = 0xC4A56A; // highlight
const WALL_DARK   = 0x6E5530; // shadow

function brickKey(col: number, row: number): string {
  return `${col},${row}`;
}

// Simple hash for deterministic per-brick variation
function brickHash(col: number, row: number): number {
  return ((col * 7919 + row * 104729) & 0xFFFF) / 0xFFFF;
}

function lerpColor(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 0xFF, g1 = (c1 >> 8) & 0xFF, b1 = c1 & 0xFF;
  const r2 = (c2 >> 16) & 0xFF, g2 = (c2 >> 8) & 0xFF, b2 = c2 & 0xFF;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

function drawWallBricks(g: Graphics, bricks: Set<string>) {
  g.clear();
  const m = 1.5; // mortar gap

  for (const key of bricks) {
    const [col, row] = key.split(',').map(Number);
    const x = col * BRICK_SIZE;
    const y = row * BRICK_SIZE;
    const h = brickHash(col, row);

    // Mortar background
    g.rect(x, y, BRICK_SIZE, BRICK_SIZE);
    g.fill({ color: WALL_MORTAR, alpha: 0.95 });

    // Two-row brick pattern inside the cell
    const isEvenRow = row % 2 === 0;
    const halfH = (BRICK_SIZE - m * 3) / 2;
    const brickW = (BRICK_SIZE - m * 2) / 2;

    // Vary base color per brick
    const baseColor = lerpColor(WALL_BASE, WALL_DARK, h * 0.35);

    // Top row: 2 bricks (offset on even rows)
    const offsetX = isEvenRow ? 0 : brickW * 0.5;
    for (let i = 0; i < 3; i++) {
      const bx = x + m + (i * (brickW + m)) - offsetX;
      const by = y + m;
      const bw = brickW;
      const bh = halfH;
      // Clip to cell bounds
      const cx1 = Math.max(bx, x + m);
      const cy1 = by;
      const cx2 = Math.min(bx + bw, x + BRICK_SIZE - m);
      const cy2 = by + bh;
      if (cx2 <= cx1) continue;

      const brickVar = lerpColor(baseColor, WALL_LIGHT, brickHash(col * 3 + i, row * 2) * 0.2);
      g.roundRect(cx1, cy1, cx2 - cx1, cy2 - cy1, 1);
      g.fill({ color: brickVar, alpha: 0.92 });
      // Top edge highlight
      g.moveTo(cx1 + 1, cy1 + 0.5);
      g.lineTo(cx2 - 1, cy1 + 0.5);
      g.stroke({ color: WALL_LIGHT, alpha: 0.3, width: 0.8 });
      // Bottom edge shadow
      g.moveTo(cx1 + 1, cy2 - 0.5);
      g.lineTo(cx2 - 1, cy2 - 0.5);
      g.stroke({ color: WALL_DARK, alpha: 0.25, width: 0.8 });
    }

    // Bottom row: offset by half
    const offsetX2 = isEvenRow ? brickW * 0.5 : 0;
    for (let i = 0; i < 3; i++) {
      const bx = x + m + (i * (brickW + m)) - offsetX2;
      const by = y + m * 2 + halfH;
      const bw = brickW;
      const bh = halfH;
      const cx1 = Math.max(bx, x + m);
      const cy1 = by;
      const cx2 = Math.min(bx + bw, x + BRICK_SIZE - m);
      const cy2 = Math.min(by + bh, y + BRICK_SIZE - m);
      if (cx2 <= cx1 || cy2 <= cy1) continue;

      const brickVar = lerpColor(baseColor, WALL_LIGHT, brickHash(col * 3 + i, row * 2 + 1) * 0.2);
      g.roundRect(cx1, cy1, cx2 - cx1, cy2 - cy1, 1);
      g.fill({ color: brickVar, alpha: 0.92 });
      g.moveTo(cx1 + 1, cy1 + 0.5);
      g.lineTo(cx2 - 1, cy1 + 0.5);
      g.stroke({ color: WALL_LIGHT, alpha: 0.3, width: 0.8 });
      g.moveTo(cx1 + 1, cy2 - 0.5);
      g.lineTo(cx2 - 1, cy2 - 0.5);
      g.stroke({ color: WALL_DARK, alpha: 0.25, width: 0.8 });
    }
  }
}

function drawDataFlows(g: Graphics, entityMap: Map<string, Container>, elapsed: number, selectedTarget: string | null) {
  g.clear();

  const gw = entityMap.get('gateway');
  if (!gw) {
    return;
  }

  const hasFocus = selectedTarget !== null;

  for (const [key, entity] of entityMap.entries()) {
    if (!key.startsWith('agent:')) {
      continue;
    }

    const isRelevant = !hasFocus || selectedTarget === key || selectedTarget === 'gateway';
    const lineAlpha = isRelevant ? 0.35 : 0.06;
    const particleAlpha = isRelevant ? 0.9 : 0.15;
    const lineColor = isRelevant ? 0x22d3ee : 0x1e293b;

    const fromX = gw.x;
    const fromY = gw.y;
    const toX = entity.x;
    const toY = entity.y;
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2 - 25;

    const steps = 24;
    const dashLen = 3;
    for (let i = 0; i < steps; i++) {
      const isDash = (i + Math.floor(elapsed * 0.06)) % (dashLen * 2) < dashLen;
      if (!isDash) {
        continue;
      }
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const x0 = (1 - t0) * (1 - t0) * fromX + 2 * (1 - t0) * t0 * midX + t0 * t0 * toX;
      const y0 = (1 - t0) * (1 - t0) * fromY + 2 * (1 - t0) * t0 * midY + t0 * t0 * toY;
      const x1 = (1 - t1) * (1 - t1) * fromX + 2 * (1 - t1) * t1 * midX + t1 * t1 * toX;
      const y1 = (1 - t1) * (1 - t1) * fromY + 2 * (1 - t1) * t1 * midY + t1 * t1 * toY;
      g.moveTo(x0, y0).lineTo(x1, y1);
      g.stroke({ color: lineColor, alpha: lineAlpha, width: isRelevant ? 1.5 : 0.8 });
    }

    if (isRelevant) {
      const pt = (elapsed * 0.015) % 1;
      const px = (1 - pt) * (1 - pt) * fromX + 2 * (1 - pt) * pt * midX + pt * pt * toX;
      const py = (1 - pt) * (1 - pt) * fromY + 2 * (1 - pt) * pt * midY + pt * pt * toY;
      g.circle(px, py, 2.5);
      g.fill({ color: 0x22d3ee, alpha: particleAlpha });
    }
  }

  // Draw data flows from each agent to its own buildings (per-agent association)
  for (const [agentKey, agentEntity] of entityMap.entries()) {
    if (!agentKey.startsWith('agent:')) continue;
    const agentId = agentKey.replace('agent:', '');

    for (const [buildingKey, building] of entityMap.entries()) {
      if (!buildingKey.startsWith('building:')) continue;
      // Match: building:skills:main → agentId "main"
      const parts = buildingKey.split(':');
      const buildingAgentId = parts.length >= 3 ? parts[2] : undefined;
      if (buildingAgentId !== agentId) continue;

      const isRelevant = !hasFocus || selectedTarget === buildingKey || selectedTarget === agentKey;
      const lineAlpha = isRelevant ? 0.25 : 0.04;
      const lineColor = isRelevant ? 0x6366f1 : 0x1e293b;

      const fromX = agentEntity.x;
      const fromY = agentEntity.y;
      const toX = building.x;
      const toY = building.y;
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2 - 15;

      const steps = 16;
      for (let i = 0; i < steps; i++) {
        if ((i + Math.floor(elapsed * 0.04)) % 4 < 2) {
          continue;
        }
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const x0 = (1 - t0) * (1 - t0) * fromX + 2 * (1 - t0) * t0 * midX + t0 * t0 * toX;
        const y0 = (1 - t0) * (1 - t0) * fromY + 2 * (1 - t0) * t0 * midY + t0 * t0 * toY;
        const x1 = (1 - t1) * (1 - t1) * fromX + 2 * (1 - t1) * t1 * midX + t1 * t1 * toX;
        const y1 = (1 - t1) * (1 - t1) * fromY + 2 * (1 - t1) * t1 * midY + t1 * t1 * toY;
        g.moveTo(x0, y0).lineTo(x1, y1);
        g.stroke({ color: lineColor, alpha: lineAlpha, width: isRelevant ? 1.2 : 0.6 });
      }
    }
  }

  // Draw data flows from Gateway to global buildings (no agentId)
  for (const [buildingKey, building] of entityMap.entries()) {
    if (!buildingKey.startsWith('building:')) continue;
    const parts = buildingKey.split(':');
    // Global buildings have format "building:channels" (no third segment)
    if (parts.length >= 3) continue; // skip per-agent buildings

    const isRelevant = !hasFocus || selectedTarget === buildingKey || selectedTarget === 'gateway';
    const lineAlpha = isRelevant ? 0.2 : 0.03;
    const lineColor = isRelevant ? 0xfbbf24 : 0x1e293b; // amber for global

    const fromX = gw.x;
    const fromY = gw.y;
    const toX = building.x;
    const toY = building.y;
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2 - 20;

    const steps = 16;
    for (let i = 0; i < steps; i++) {
      if ((i + Math.floor(elapsed * 0.03)) % 4 < 2) continue;
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const x0 = (1 - t0) * (1 - t0) * fromX + 2 * (1 - t0) * t0 * midX + t0 * t0 * toX;
      const y0 = (1 - t0) * (1 - t0) * fromY + 2 * (1 - t0) * t0 * midY + t0 * t0 * toY;
      const x1 = (1 - t1) * (1 - t1) * fromX + 2 * (1 - t1) * t1 * midX + t1 * t1 * toX;
      const y1 = (1 - t1) * (1 - t1) * fromY + 2 * (1 - t1) * t1 * midY + t1 * t1 * toY;
      g.moveTo(x0, y0).lineTo(x1, y1);
      g.stroke({ color: lineColor, alpha: lineAlpha, width: isRelevant ? 1.0 : 0.5 });
    }
  }
}

interface FloatingText {
  text: string;
  x: number;
  y: number;
  color: number;
  created: number;
  duration: number;
}

const floatingTexts: FloatingText[] = [];

function spawnFloatingText(text: string, x: number, y: number, color = 0x22c55e) {
  floatingTexts.push({ text, x, y, color, created: Date.now(), duration: 2000 });
}

function drawFloatingTexts(container: Container) {
  const toRemove = container.children.filter((child) => child.label === '__float_text');
  toRemove.forEach((child) => container.removeChild(child));

  const now = Date.now();
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    const age = now - ft.created;
    if (age > ft.duration) {
      floatingTexts.splice(i, 1);
      continue;
    }

    const progress = age / ft.duration;
    const t = new Text({
      text: ft.text,
      style: new TextStyle({ fontSize: 11, fill: ft.color, fontFamily: 'monospace', fontWeight: 'bold' }),
    });
    t.label = '__float_text';
    t.anchor.set(0.5, 1);
    t.position.set(ft.x, ft.y - 40 - progress * 40);
    t.alpha = 1 - progress * progress;
    container.addChild(t);
  }
}

interface TooltipState {
  x: number;
  y: number;
  text: string;
}

interface TooltipTarget {
  targetKey: string;
  text: string;
}

function normalizeTooltipKey(entityId: string): string {
  if (entityId.startsWith('skills:')) return 'skills';
  if (entityId.startsWith('memory:')) return 'memory';
  if (entityId.startsWith('files:')) return 'files';
  if (entityId === 'channel') return 'channels';
  if (entityId === 'model') return 'models';
  if (entityId === 'plugin') return 'plugins';
  if (entityId === 'crons') return 'cron';
  return entityId;
}

function getTooltipText(entityId: string, entityType: EntityType): string | null {
  if (entityType === 'gateway') return '🏰 点击管理 Gateway 设置';
  if (entityType === 'agent') return `🏛️ 点击查看领主 ${entityId}`;
  if (entityType === 'session') return '⚔️ 点击查看探险详情';

  if (entityId.startsWith('skills:')) return '📚 点击管理技能';
  if (entityId.startsWith('memory:')) return '🧠 点击管理记忆';
  if (entityId.startsWith('files:')) return '📁 点击管理文件';

  const normalizedId = normalizeTooltipKey(entityId);
  const map: Record<string, string> = {
    channels: '📡 点击管理频道连接',
    models: '🔥 点击管理模型配置',
    plugins: '🔧 点击查看插件',
    tools: '⚒️ 点击查看工具库',
    cron: '⏰ 点击管理定时任务',
  };

  return map[normalizedId] || `🏠 点击打开 ${normalizedId}`;
}

interface WorldCanvasProps {
  onEntityClick?: (entityId: string, entityType: EntityType) => void;
}

export function WorldCanvas({ onEntityClick }: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const entityMapRef = useRef<Map<string, Container>>(new Map());
  const animFrameRef = useRef<number>(0);
  const cameraDragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({ dragging: false, lastX: 0, lastY: 0 });
  const entityDragRef = useRef<{
    dragStarted: boolean;
    entity: Container;
    entityId: string;
    entityKey: string;
    entityType: EntityType;
    pointerOffsetX: number;
    pointerOffsetY: number;
    startGlobalX: number;
    startGlobalY: number;
  } | null>(null);
  const customPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const selectionRingRef = useRef<{ ring: Graphics; target: string | null }>({ ring: new Graphics(), target: null });
  const hoverRingRef = useRef<{ ring: Graphics; target: string | null }>({ ring: new Graphics(), target: null });
  const dataFlowRef = useRef<Graphics>(new Graphics());
  const particleGfxRef = useRef<Graphics>(new Graphics());
  const groundGridRef = useRef<Graphics>(new Graphics());
  const vignetteRef = useRef<Graphics>(new Graphics());
  const wallsRef = useRef<Graphics>(new Graphics());
  const wallBricksRef = useRef<Set<string>>(new Set());
  const wallBricksDirtyRef = useRef(true);  // only redraw bricks when changed
  const wallToolRef = useRef<{ active: boolean; painting: boolean; erasing: boolean; lockAxis: 'none' | 'h' | 'v'; startCol: number; startRow: number }>({ active: false, painting: false, erasing: false, lockAxis: 'none', startCol: 0, startRow: 0 });
  const wallGhostRef = useRef<Graphics>(new Graphics());
  const wallGhostPosRef = useRef<{ col: number; row: number } | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const viewportSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const lastGridCameraRef = useRef<{ x: number; y: number; s: number }>({ x: NaN, y: NaN, s: NaN });
  const sessionBirthRef = useRef<Map<string, number>>(new Map());
  const buildingSmokeRef = useRef<Map<string, SmokeSeed[]>>(new Map());
  const tooltipTargetRef = useRef<TooltipTarget | null>(null);
  const tooltipStateRef = useRef<TooltipState | null>(null);
  const elapsedRef = useRef(0);
  const entityClickRef = useRef(onEntityClick);
  entityClickRef.current = onEntityClick;

  function syncTooltipState(next: TooltipState | null) {
    const prev = tooltipStateRef.current;
    const roundedNext = next ? { ...next, x: Math.round(next.x), y: Math.round(next.y) } : null;

    if (
      prev?.text === roundedNext?.text
      && prev?.x === roundedNext?.x
      && prev?.y === roundedNext?.y
    ) {
      return;
    }

    tooltipStateRef.current = roundedNext;
    setTooltipState(roundedNext);
  }

  function isLayoutPosition(value: unknown): value is { x: number; y: number } {
    return typeof value === 'object'
      && value !== null
      && typeof (value as { x?: unknown }).x === 'number'
      && Number.isFinite((value as { x: number }).x)
      && typeof (value as { y?: unknown }).y === 'number'
      && Number.isFinite((value as { y: number }).y);
  }

  function getEntityKey(entityId: string, entityType: EntityType) {
    return entityType === 'gateway' ? 'gateway' : `${entityType}:${entityId}`;
  }

  function readEntityPosition(entityKey: string, fallbackX: number, fallbackY: number) {
    return customPositionsRef.current.get(entityKey) ?? { x: fallbackX, y: fallbackY };
  }

  function syncEntityPosition(entity: Container, entityKey: string, fallbackX: number, fallbackY: number) {
    if (entityDragRef.current?.entityKey === entityKey) {
      return;
    }

    const nextPosition = readEntityPosition(entityKey, fallbackX, fallbackY);
    if (entity.x !== nextPosition.x || entity.y !== nextPosition.y) {
      entity.position.set(nextPosition.x, nextPosition.y);
    }
  }

  async function loadLayout() {
    try {
      const response = await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'layout.load', params: {} }),
      });
      const result = await response.json();
      if (!result?.ok || typeof result?.data !== 'object' || result.data === null) {
        return;
      }

      const positions = result.data.positions;
      if (typeof positions === 'object' && positions !== null) {
        const nextPositions = new Map<string, { x: number; y: number }>();
        for (const [entityKey, position] of Object.entries(positions as Record<string, unknown>)) {
          if (isLayoutPosition(position)) {
            const entityType: EntityType = entityKey === 'gateway' ? 'gateway'
              : entityKey.startsWith('agent:') ? 'agent'
              : entityKey.startsWith('building:') ? 'building'
              : 'session';
            const [sx, sy] = snapEntity(position.x, position.y, entityType, entityKey);
            nextPositions.set(entityKey, { x: sx, y: sy });
          }
        }
        customPositionsRef.current = nextPositions;
      }

      // Load wall bricks
      const walls = result.data.walls;
      if (Array.isArray(walls)) {
        const bricks = new Set<string>();
        for (const w of walls) {
          if (typeof w?.col === 'number' && typeof w?.row === 'number') {
            bricks.add(brickKey(w.col, w.row));
          }
        }
        wallBricksRef.current = bricks;
        wallBricksDirtyRef.current = true;
      }
    } catch (error) {
      console.error('[clawcraft] Failed to load layout', error);
    }
  }

  async function saveLayoutPosition(entityKey: string, x: number, y: number) {
    try {
      await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'layout.save',
          params: { positions: { [entityKey]: { x, y } } },
        }),
      });
    } catch (error) {
      console.error('[clawcraft] Failed to save layout', error);
    }
  }

  async function saveWalls(bricks: Set<string>) {
    const walls = [...bricks].map(key => {
      const [col, row] = key.split(',').map(Number);
      return { col, row };
    });
    try {
      await fetch('/clawcraft/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'layout.save',
          params: { walls },
        }),
      });
    } catch (error) {
      console.error('[clawcraft] Failed to save walls', error);
    }
  }

  function selectEntity(entity: Container, entityId: string, entityType: EntityType) {
    soundManager.play('select');
    selectionRingRef.current.target = entity.label ?? null;

    if (entityClickRef.current) {
      entityClickRef.current(entityId, entityType);
    }
  }

  function finishEntityInteraction(shouldSelect: boolean) {
    const dragState = entityDragRef.current;
    if (!dragState) {
      return;
    }

    if (dragState.dragStarted) {
      const [snappedX, snappedY] = snapEntity(dragState.entity.x, dragState.entity.y, dragState.entityType, dragState.entityKey);
      dragState.entity.position.set(snappedX, snappedY);
      const nextPosition = { x: snappedX, y: snappedY };
      customPositionsRef.current.set(dragState.entityKey, nextPosition);
      void saveLayoutPosition(dragState.entityKey, nextPosition.x, nextPosition.y);
      dragState.entity.cursor = 'pointer';
    } else if (shouldSelect) {
      selectEntity(dragState.entity, dragState.entityId, dragState.entityType);
    }

    entityDragRef.current = null;
  }

  function syncViewportLayers() {
    const app = appRef.current;
    if (!app) {
      return;
    }

    const width = app.screen.width;
    const height = app.screen.height;
    const hasChanged = width !== viewportSizeRef.current.width || height !== viewportSizeRef.current.height;
    if (!hasChanged) {
      return;
    }

    drawGroundGrid(groundGridRef.current, width, height, worldRef.current?.x ?? 0, worldRef.current?.y ?? 0, worldRef.current?.scale?.x ?? 1);
    drawViewportVignette(vignetteRef.current, width, height);
    particlesRef.current = createAmbientParticles(width < 640 ? 20 : 60, width, height);
    app.stage.hitArea = app.screen;
    viewportSizeRef.current = { width, height };
  }

  function panCameraToEntity(entity: Container) {
    const world = worldRef.current;
    const app = appRef.current;
    if (!world || !app) {
      return;
    }

    const isMobile = app.screen.width < 640;
    const targetScreenY = isMobile ? app.screen.height * 0.28 : app.screen.height * 0.36;
    const targetScreenX = app.screen.width * 0.5;
    const goalX = targetScreenX - entity.x * world.scale.x;
    const goalY = targetScreenY - entity.y * world.scale.y;
    const startX = world.x;
    const startY = world.y;
    const dx = goalX - startX;
    const dy = goalY - startY;
    let t = 0;

    const cameraTween = () => {
      t += 0.06;
      if (t >= 1) {
        world.x = goalX;
        world.y = goalY;
        return;
      }

      const ease = 1 - Math.pow(1 - t, 3);
      world.x = startX + dx * ease;
      world.y = startY + dy * ease;
      requestAnimationFrame(cameraTween);
    };

    requestAnimationFrame(cameraTween);
  }

  useEffect(() => {
    void loadLayout();
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const app = new Application();
    const initPromise = app.init({
      resizeTo: containerRef.current,
      background: 0x0a0e1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    let destroyed = false;

    initPromise.then(() => {
      if (destroyed) {
        app.destroy(true);
        return;
      }

      containerRef.current!.appendChild(app.canvas as HTMLCanvasElement);
      appRef.current = app;

      const world = new Container();
      world.label = 'world';
      app.stage.addChild(world);
      worldRef.current = world;

      const ground = groundGridRef.current;
      ground.label = '__ground_grid';
      world.addChild(ground);

      const particleGfx = particleGfxRef.current;
      particleGfx.label = '__particles';
      world.addChild(particleGfx);

      const dataFlow = dataFlowRef.current;
      dataFlow.label = '__data_flows';
      world.addChild(dataFlow);

      const walls = wallsRef.current;
      walls.label = '__walls';
      world.addChild(walls);

      const wallGhost = wallGhostRef.current;
      wallGhost.label = '__wall_ghost';
      world.addChild(wallGhost);

      const hRing = hoverRingRef.current.ring;
      const sRing = selectionRingRef.current.ring;
      hRing.label = '__hover_ring';
      sRing.label = '__selection_ring';
      world.addChild(hRing);
      world.addChild(sRing);

      const vignette = vignetteRef.current;
      vignette.label = '__vignette';
      vignette.eventMode = 'none';
      app.stage.addChild(vignette);

      const centerWorld = () => {
        const isMobile = app.screen.width < 640;
        world.x = app.screen.width / 2;
        world.y = isMobile ? app.screen.height * 0.18 : app.screen.height * 0.22;
      };

      centerWorld();
      syncViewportLayers();

      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
        // Wall tool: start painting/erasing bricks
        if (wallToolRef.current.active && world) {
          const localPointer = world.toLocal(e.global);
          const col = Math.floor(localPointer.x / BRICK_SIZE);
          const row = Math.floor(localPointer.y / BRICK_SIZE);
          const key = brickKey(col, row);
          const erasing = wallBricksRef.current.has(key);

          wallToolRef.current.painting = true;
          wallToolRef.current.erasing = erasing;
          wallToolRef.current.startCol = col;
          wallToolRef.current.startRow = row;
          wallToolRef.current.lockAxis = 'none';

          if (erasing) {
            wallBricksRef.current.delete(key);
          } else {
            wallBricksRef.current.add(key);
          }
          wallBricksDirtyRef.current = true;
          soundManager.play('select');
          return;
        }
        if (entityDragRef.current) {
          return;
        }
        cameraDragRef.current = { dragging: true, lastX: e.globalX, lastY: e.globalY };
      });
      app.stage.on('pointermove', (e: FederatedPointerEvent) => {
        // Wall ghost preview: show brick at cursor when wall tool active
        if (wallToolRef.current.active && worldRef.current && !wallToolRef.current.painting) {
          const localPointer = worldRef.current.toLocal(e.global);
          const col = Math.floor(localPointer.x / BRICK_SIZE);
          const row = Math.floor(localPointer.y / BRICK_SIZE);
          wallGhostPosRef.current = { col, row };
        } else if (!wallToolRef.current.active) {
          wallGhostPosRef.current = null;
        }

        // Wall painting: add/erase bricks while dragging
        if (wallToolRef.current.active && wallToolRef.current.painting && worldRef.current) {
          const localPointer = worldRef.current.toLocal(e.global);
          let col = Math.floor(localPointer.x / BRICK_SIZE);
          let row = Math.floor(localPointer.y / BRICK_SIZE);
          const wt = wallToolRef.current;

          // Shift = lock to axis of first movement
          if (e.shiftKey) {
            if (wt.lockAxis === 'none' && (col !== wt.startCol || row !== wt.startRow)) {
              wt.lockAxis = Math.abs(col - wt.startCol) >= Math.abs(row - wt.startRow) ? 'h' : 'v';
            }
            if (wt.lockAxis === 'h') row = wt.startRow;
            if (wt.lockAxis === 'v') col = wt.startCol;
          } else {
            wt.lockAxis = 'none';
          }

          const key = brickKey(col, row);
          if (wt.erasing) {
            wallBricksRef.current.delete(key);
          } else {
            wallBricksRef.current.add(key);
          }
          return;
        }

        const entityDrag = entityDragRef.current;
        if (entityDrag) {
          const distance = Math.hypot(e.globalX - entityDrag.startGlobalX, e.globalY - entityDrag.startGlobalY);
          if (!entityDrag.dragStarted && distance >= DRAG_CLICK_THRESHOLD) {
            entityDrag.dragStarted = true;
            entityDrag.entity.cursor = 'grabbing';
            hoverRingRef.current.target = null;
          }

          if (!entityDrag.dragStarted || !worldRef.current) {
            return;
          }

          const localPointer = worldRef.current.toLocal(e.global);
          const [sx, sy] = snapEntity(
            localPointer.x + entityDrag.pointerOffsetX,
            localPointer.y + entityDrag.pointerOffsetY,
            entityDrag.entityType,
            entityDrag.entityKey,
          );
          entityDrag.entity.position.set(sx, sy);
          return;
        }

        if (!cameraDragRef.current.dragging) {
          return;
        }
        const dx = e.globalX - cameraDragRef.current.lastX;
        const dy = e.globalY - cameraDragRef.current.lastY;
        world.x += dx;
        world.y += dy;
        cameraDragRef.current.lastX = e.globalX;
        cameraDragRef.current.lastY = e.globalY;
      });
      app.stage.on('pointerup', () => {
        if (wallToolRef.current.painting) {
          wallToolRef.current.painting = false;
          void saveWalls(wallBricksRef.current);
        }
        finishEntityInteraction(false);
        cameraDragRef.current.dragging = false;
      });
      app.stage.on('pointerupoutside', () => {
        if (wallToolRef.current.painting) {
          wallToolRef.current.painting = false;
          void saveWalls(wallBricksRef.current);
        }
        finishEntityInteraction(false);
        cameraDragRef.current.dragging = false;
      });

      containerRef.current!.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.04 : 0.96;
        const newScale = Math.min(2, Math.max(0.3, world.scale.x * factor));
        world.scale.set(newScale, newScale);
      }, { passive: false });

      let lastPinchDist = 0;
      const el = containerRef.current!;
      el.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastPinchDist = Math.sqrt(dx * dx + dy * dy);
        }
      }, { passive: true });
      el.addEventListener('touchmove', (e: TouchEvent) => {
        if (e.touches.length === 2 && lastPinchDist > 0) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const factor = dist / lastPinchDist;
          const newScale = Math.min(2, Math.max(0.3, world.scale.x * factor));
          world.scale.set(newScale, newScale);
          lastPinchDist = dist;
        }
      }, { passive: false });
      el.addEventListener('touchend', () => {
        lastPinchDist = 0;
      }, { passive: true });

      (window as any).__resetView = () => {
        centerWorld();
        world.scale.set(1, 1);
      };
      (window as any).__panToEntity = (entityId: string, entityType: EntityType) => {
        const targetKey = entityType === 'gateway' ? 'gateway' : `${entityType}:${entityId}`;
        const entity = entityMapRef.current.get(targetKey);
        if (!entity) {
          return;
        }

        selectionRingRef.current.target = entity.label ?? null;
        panCameraToEntity(entity);
      };
      (window as any).__floatText = (buildingId: string, text: string, color?: number) => {
        const entity = entityMapRef.current.get(`building:${buildingId}`) ?? entityMapRef.current.get(buildingId);
        if (entity) {
          spawnFloatingText(text, entity.x, entity.y, color);
        }
      };

      const tick = () => {
        if (destroyed) {
          return;
        }
        updateWorld();
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    });

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Esc: exit wall tool
      if (e.key === 'Escape' && wallToolRef.current.active) {
        wallToolRef.current.active = false;
        wallToolRef.current.painting = false;
        wallGhostPosRef.current = null;
        containerRef.current?.style.setProperty('--wall-tool', '0');
        return;
      }
      // R: reset camera to origin
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && worldRef.current) {
        const w = worldRef.current;
        w.position.set(0, 0);
        w.scale.set(1, 1);
        return;
      }
      // Ctrl+Z / Cmd+Z: undo last brick stroke
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && wallToolRef.current.active) {
        // Remove last added brick (simplistic undo)
        const bricks = wallBricksRef.current;
        const arr = [...bricks];
        if (arr.length > 0) {
          bricks.delete(arr[arr.length - 1]);
          void saveWalls(bricks);
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      destroyed = true;
      cancelAnimationFrame(animFrameRef.current);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      delete (window as any).__panToEntity;
      delete (window as any).__resetView;
      delete (window as any).__floatText;
    };
  }, []);

  function bindEntityEvents(entity: Container, entityId: string, entityType: EntityType) {
    entity.eventMode = 'static';
    entity.cursor = 'pointer';

    const entityKey = getEntityKey(entityId, entityType);
    const isDraggable = entityType === 'gateway' || entityType === 'agent' || entityType === 'building';

    if (isDraggable) {
      entity.on('pointerdown', (e: FederatedPointerEvent) => {
        const world = worldRef.current;
        if (!world) {
          return;
        }

        e.stopPropagation();
        tooltipTargetRef.current = null;
        const localPointer = world.toLocal(e.global);
        entityDragRef.current = {
          dragStarted: false,
          entity,
          entityId,
          entityKey,
          entityType,
          pointerOffsetX: entity.x - localPointer.x,
          pointerOffsetY: entity.y - localPointer.y,
          startGlobalX: e.globalX,
          startGlobalY: e.globalY,
        };
      });

      entity.on('pointerup', (e: FederatedPointerEvent) => {
        e.stopPropagation();
        finishEntityInteraction(true);
      });

      entity.on('pointerupoutside', () => {
        finishEntityInteraction(false);
      });
    } else {
      entity.on('pointertap', () => {
        selectEntity(entity, entityId, entityType);
      });
    }

    entity.on('pointerover', () => {
      if (entityType !== 'gateway') {
        soundManager.play('hover');
      }
      hoverRingRef.current.target = entity.label ?? null;
      if (entityType === 'agent' || entityType === 'building') {
        entity.scale.set(1.05);
      }

      const tooltipText = getTooltipText(entityId, entityType);
      tooltipTargetRef.current = tooltipText && entity.label
        ? { targetKey: entityKey, text: tooltipText }
        : null;
    });

    entity.on('pointerout', () => {
      hoverRingRef.current.target = null;
      if (entityType === 'agent' || entityType === 'building') {
        entity.scale.set(1);
      }
      if (tooltipTargetRef.current?.targetKey === entityKey) {
        tooltipTargetRef.current = null;
      }
    });
  }

  function updateWorld() {
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) {
      return;
    }

    syncViewportLayers();

    // Redraw ground grid only when camera moved by a grid unit or zoom changed (infinite canvas)
    const vp = viewportSizeRef.current;
    const currentScale = world.scale.x;
    const snappedX = Math.floor(world.x / GRID_UNIT);
    const snappedY = Math.floor(world.y / GRID_UNIT);
    const snappedS = Math.round(currentScale * 100);
    const lastGrid = lastGridCameraRef.current;
    if (snappedX !== lastGrid.x || snappedY !== lastGrid.y || snappedS !== lastGrid.s) {
      drawGroundGrid(groundGridRef.current, vp.width, vp.height, world.x, world.y, currentScale);
      lastGridCameraRef.current = { x: snappedX, y: snappedY, s: snappedS };
    }

    const state = useWorldStore.getState();
    const { agents, sessions, buildings } = state;
    const entityMap = entityMapRef.current;

    function gridPos(col: number, totalCols: number, row: number, widthCells = 1, heightCells = 1): [number, number] {
      const offsetX = -(totalCols - 1) / 2;
      const rawX = (offsetX + col) * GRID_SPACING * GRID_UNIT;
      const rawY = row * GRID_SPACING * GRID_UNIT;
      return [snapToGrid(rawX, widthCells), snapToGrid(rawY, heightCells)];
    }

    if (!entityMap.has('gateway')) {
      const gateway = createGatewayEntity();
      const [sx, sy] = gridPos(0, 1, 0, 3, 3);
      const position = readEntityPosition('gateway', sx, sy);
      gateway.position.set(position.x, position.y);
      bindEntityEvents(gateway, 'gateway', 'gateway');
      world.addChild(gateway);
      entityMap.set('gateway', gateway);
    } else {
      const gateway = entityMap.get('gateway');
      if (gateway) {
        const [sx, sy] = gridPos(0, 1, 0, 3, 3);
        syncEntityPosition(gateway, 'gateway', sx, sy);
      }
    }

    const gatewayEntity = entityMap.get('gateway');
    if (gatewayEntity) {
      const breath = 0.97 + Math.sin(Date.now() / 1500) * 0.03;
      const hoverScale = hoverRingRef.current.target === gatewayEntity.label ? 1.05 : 1;
      gatewayEntity.scale.set(breath * hoverScale);
    }

    const agentIds = Object.keys(agents);
    agentIds.forEach((agentId, index) => {
      const key = `agent:${agentId}`;
      if (!entityMap.has(key)) {
        const entity = createAgentEntity(agents[agentId], index);
        const [sx, sy] = gridPos(index, agentIds.length, 1, 2, 2);
        const position = readEntityPosition(key, sx, sy);
        entity.position.set(position.x, position.y);
        bindEntityEvents(entity, agentId, 'agent');
        world.addChild(entity);
        entityMap.set(key, entity);
      }

      const agentEntity = entityMap.get(key);
      if (agentEntity) {
        const [sx, sy] = gridPos(index, agentIds.length, 1, 2, 2);
        syncEntityPosition(agentEntity, key, sx, sy);
        const labelText = agentEntity.children.find((child) => child.label === '__agent_name') as Text | undefined;
        if (labelText) {
          labelText.text = agents[agentId].name;
        }
      }
    });

    const sessionKeys = Object.keys(sessions);
    sessionKeys.forEach((sessionKey) => {
      const session = sessions[sessionKey];
      const sessionMapKey = `session:${sessionKey}`;
      const agentIdx = agentIds.indexOf(session.agentId);
      const agentColor = AGENT_COLORS[agentIdx >= 0 ? agentIdx % AGENT_COLORS.length : 0];

      if (!entityMap.has(sessionMapKey)) {
        const entity = createSessionEntity(session, agentColor);
        bindEntityEvents(entity, sessionKey, 'session');
        world.addChild(entity);
        entityMap.set(sessionMapKey, entity);
        sessionBirthRef.current.set(sessionMapKey, performance.now());
      }

      const agentEntity = entityMap.get(`agent:${session.agentId}`);
      const sessionEntity = entityMap.get(sessionMapKey);
      if (!agentEntity || !sessionEntity) {
        return;
      }

      const sessionIdx = Object.values(sessions)
        .filter((item) => item.agentId === session.agentId)
        .indexOf(session);
      const totalSessions = Object.values(sessions)
        .filter((item) => item.agentId === session.agentId).length;
      // Orbit around agent
      const orbitRadius = 45 + sessionIdx * 8;
      const angleOffset = (2 * Math.PI * sessionIdx) / Math.max(totalSessions, 1);
      const orbitSpeed = 0.0008 + sessionIdx * 0.0002;
      const angle = Date.now() * orbitSpeed + angleOffset;
      const targetX = agentEntity.x + Math.cos(angle) * orbitRadius;
      const targetY = agentEntity.y + Math.sin(angle) * orbitRadius;
      sessionEntity.x += (targetX - sessionEntity.x) * 0.08;
      sessionEntity.y += (targetY - sessionEntity.y) * 0.08;

      const sessionGfx = sessionEntity.children[0] as Graphics;
      const birthRing = sessionEntity.children.find((child) => child.label === '__birth_ring') as Graphics | undefined;
      const statusColor = STATUS_COLORS[session.status] ?? 0x64748b;
      drawBlock(sessionGfx, SESSION_W, SESSION_H, agentColor, 0.7, statusColor, 1, 2);

      const birthStartedAt = sessionBirthRef.current.get(sessionMapKey);
      const birthProgress = birthStartedAt ? Math.min(1, (performance.now() - birthStartedAt) / 900) : 1;
      const birthScale = elasticOut(birthProgress);

      birthRing?.clear();
      if (birthRing && birthProgress < 1) {
        const ringSize = SESSION_W + 8 + birthProgress * 22;
        birthRing.rect(-(ringSize / 2), -(ringSize / 2), ringSize, ringSize);
        birthRing.stroke({ color: statusColor, alpha: (1 - birthProgress) * 0.65, width: 2 });
      } else if (birthStartedAt) {
        sessionBirthRef.current.delete(sessionMapKey);
      }

      if (session.status === 'ended') {
        sessionEntity.alpha = Math.max(0, sessionEntity.alpha - 0.008);
        const scale = Math.max(0.3, sessionEntity.alpha);
        sessionEntity.scale.set(scale);
        sessionEntity.rotation += 0.02;
      } else {
        sessionEntity.alpha = 1;
        sessionEntity.rotation = 0;
        let scale = birthScale;
        if (session.status === 'thinking') {
          scale *= 1 + Math.sin(Date.now() / 300) * 0.1;
        }
        if (hoverRingRef.current.target === sessionEntity.label) {
          scale *= 1.05;
        }
        sessionEntity.scale.set(scale);
      }
    });

    if (buildings && buildings.length > 0) {
      // Separate per-agent buildings from global buildings
      const globalBuildings = buildings.filter(b => !b.agentId);
      const agentBuildingsMap = new Map<string, typeof buildings>();
      const perAgentBuildingRow = (building: (typeof buildings)[number], fallbackIndex: number) => {
        if (building.id.startsWith('skills:') || building.type === 'skill') return 2;
        if (building.id.startsWith('memory:') || building.type === 'memory') return 3;
        if (building.id.startsWith('files:') || building.type === 'files') return 4;
        return 2 + fallbackIndex;
      };

      for (const b of buildings) {
        if (b.agentId) {
          const list = agentBuildingsMap.get(b.agentId) ?? [];
          list.push(b);
          agentBuildingsMap.set(b.agentId, list);
        }
      }

      // Place per-agent buildings on a strict grid below each agent
      agentIds.forEach((agentId, agentIndex) => {
        const agentBuildings = [...(agentBuildingsMap.get(agentId) ?? [])].sort(
          (a, b) => perAgentBuildingRow(a, 0) - perAgentBuildingRow(b, 0),
        );

        agentBuildings.forEach((building, bIdx) => {
          const buildingKey = `building:${building.id}`;
          const [sx, sy] = gridPos(agentIndex, agentIds.length, perAgentBuildingRow(building, bIdx), 3, 2);

          if (!entityMap.has(buildingKey)) {
            const entity = createBuildingEntity(building);
            const position = readEntityPosition(buildingKey, sx, sy);
            entity.position.set(position.x, position.y);
            bindEntityEvents(entity, building.id, 'building');
            world.addChild(entity);
            entityMap.set(buildingKey, entity);
          }

          syncEntityPosition(entityMap.get(buildingKey)!, buildingKey, sx, sy);
        });
      });

      // Place global buildings in rows below agent zone
      const globalCols = 5;
      const globalStartRow = agentBuildingsMap.size > 0 ? 6 : 3;

      // Zone label for global buildings
      const globalLabelKey = '__zone_label_global';
      if (globalBuildings.length > 0) {
        const [labelX, labelY] = gridPos(0, 1, globalStartRow - 0.6);
        let label = entityMap.get(globalLabelKey) as Text | undefined;

        if (!label) {
          label = new Text({
            text: '⚙️ 全局设施 Global',
            style: new TextStyle({ fontSize: 11, fill: 0x94a3b8, fontFamily: 'monospace', letterSpacing: 1 }),
          });
          label.label = globalLabelKey;
          label.anchor.set(0.5, 0.5);
          label.alpha = 0.7;
          world.addChild(label);
          entityMap.set(globalLabelKey, label as unknown as Container);
        }

        label.position.set(labelX, labelY);
      }

      globalBuildings.forEach((building, index) => {
        const buildingKey = `building:${building.id}`;
        const row = Math.floor(index / globalCols);
        const col = index % globalCols;
        const colsInRow = Math.min(globalCols, globalBuildings.length - row * globalCols);
        const [sx, sy] = gridPos(col, colsInRow, globalStartRow + row, 3, 2);

        if (!entityMap.has(buildingKey)) {
          const entity = createBuildingEntity(building);
          const position = readEntityPosition(buildingKey, sx, sy);
          entity.position.set(position.x, position.y);
          bindEntityEvents(entity, building.id, 'building');
          world.addChild(entity);
          entityMap.set(buildingKey, entity);
        }

        syncEntityPosition(entityMap.get(buildingKey)!, buildingKey, sx, sy);
      });

      // Update all building visuals (same for both agent and global)
      const selectedKey = selectionRingRef.current.target;
      // Determine if a specific agent is selected to highlight its buildings
      const selectedAgentId = selectedKey?.startsWith('agent:') ? selectedKey.replace('agent:', '') : null;

      buildings.forEach((building) => {
        const buildingKey = `building:${building.id}`;
        const buildingEntity = entityMap.get(buildingKey);
        if (!buildingEntity) {
          return;
        }

        // Check if this building belongs to the selected agent
        const isGroupHighlighted = selectedAgentId !== null && building.agentId === selectedAgentId;

        const baseGfx = buildingEntity.children.find((child) => child.label === '__building_base') as Graphics | undefined;
        const badgeGfx = buildingEntity.children.find((child) => child.label === '__count_badge') as Graphics | undefined;
        const iconText = buildingEntity.children.find((child) => child.label === '__building_icon') as Text | undefined;
        const nameText = buildingEntity.children.find((child) => child.label === '__building_name') as Text | undefined;
        const countText = buildingEntity.children.find((child) => child.label === '__count_text') as Text | undefined;
        const errorFx = buildingEntity.children.find((child) => child.label === '__error_fx') as Graphics | undefined;
        const fillColor = BUILDING_STYLES[building.type]?.fill ?? 0x64748b;
        const badgeColor = BUILDING_COLORS[building.type] ?? 0x64748b;
        const badgePosition = getBuildingBadgePosition();

        if (baseGfx) {
          drawBlock(
            baseGfx,
            BUILDING_W,
            BUILDING_H,
            fillColor,
            isGroupHighlighted ? 1.0 : 0.9,
            isGroupHighlighted ? 0x60a5fa : 0xffffff,
            isGroupHighlighted ? 0.6 : 0.16,
            isGroupHighlighted ? 2.5 : 1.5,
            0.15,
          );
        }

        if (iconText) {
          iconText.text = building.icon;
        }
        if (nameText) {
          nameText.text = building.name;
        }

        if (building.count > 0) {
          if (badgeGfx) {
            drawBuildingBadge(badgeGfx, badgeColor);
          } else {
            const nextBadge = new Graphics();
            nextBadge.label = '__count_badge';
            drawBuildingBadge(nextBadge, badgeColor);
            buildingEntity.addChild(nextBadge);
          }

          if (countText) {
            countText.text = `${building.count}`;
          } else {
            const nextCount = new Text({
              text: `${building.count}`,
              style: new TextStyle({ fontSize: 9, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' }),
            });
            nextCount.anchor.set(0.5);
            nextCount.position.set(badgePosition.x, badgePosition.y);
            nextCount.label = '__count_text';
            buildingEntity.addChild(nextCount);
          }
          countText?.position.set(badgePosition.x, badgePosition.y);
        } else {
          if (badgeGfx) {
            buildingEntity.removeChild(badgeGfx);
          }
          if (countText) {
            buildingEntity.removeChild(countText);
          }
        }

        if (errorFx) {
          if (buildingHasErrors(building)) {
            const smokeSeeds = buildingSmokeRef.current.get(buildingKey) ?? createSmokeSeeds();
            buildingSmokeRef.current.set(buildingKey, smokeSeeds);
            drawBuildingAlert(errorFx, building, smokeSeeds, elapsedRef.current);
          } else {
            errorFx.clear();
          }
        }
      });
    }

    for (const [key, entity] of entityMap.entries()) {
      if (!key.startsWith('building:')) {
        continue;
      }
      if (hoverRingRef.current.target === entity.label || entityDragRef.current?.entityKey === key) {
        continue;
      }
      const breathCycle = Math.sin(Date.now() / 2000 + entity.x * 0.01) * 0.02;
      entity.scale.set(1 + breathCycle);
    }

    elapsedRef.current += 1;
    // Only redraw bricks when changed (painting/loading)
    if (wallBricksDirtyRef.current || wallToolRef.current.painting) {
      drawWallBricks(wallsRef.current, wallBricksRef.current);
      wallBricksDirtyRef.current = false;
    }
    // Ghost preview brick
    const ghost = wallGhostRef.current;
    ghost.clear();
    const gp = wallGhostPosRef.current;
    if (gp && wallToolRef.current.active) {
      const gx = gp.col * BRICK_SIZE;
      const gy = gp.row * BRICK_SIZE;
      const isErase = wallBricksRef.current.has(brickKey(gp.col, gp.row));
      ghost.rect(gx, gy, BRICK_SIZE, BRICK_SIZE);
      ghost.fill({ color: isErase ? 0xff4444 : WALL_BASE, alpha: 0.4 });
      ghost.rect(gx, gy, BRICK_SIZE, BRICK_SIZE);
      ghost.stroke({ color: isErase ? 0xff4444 : WALL_LIGHT, alpha: 0.7, width: 1.5 });
    }
    drawDataFlows(dataFlowRef.current, entityMap, elapsedRef.current, selectionRingRef.current.target);
    drawAmbientParticles(particleGfxRef.current, particlesRef.current, elapsedRef.current);
    drawFloatingTexts(world);

    const hoverRef = hoverRingRef.current;
    const selectionRef = selectionRingRef.current;

    hoverRef.ring.clear();
    if (hoverRef.target) {
      const hoverEntity = entityMap.get(hoverRef.target);
      if (hoverEntity) {
        hoverRef.ring.position.set(hoverEntity.x, hoverEntity.y);
        drawSelectionRing(hoverRef.ring, getSelectionShape(hoverRef.target), false);
      }
    }

    selectionRef.ring.clear();
    if (selectionRef.target) {
      const selectedEntity = entityMap.get(selectionRef.target);
      if (selectedEntity) {
        selectionRef.ring.position.set(selectedEntity.x, selectedEntity.y);
        drawSelectionRing(selectionRef.ring, getSelectionShape(selectionRef.target), true);
      }
    }

    const tooltipTarget = tooltipTargetRef.current;
    if (tooltipTarget) {
      const hoveredEntity = entityMap.get(tooltipTarget.targetKey);
      if (hoveredEntity) {
        const screenPos = hoveredEntity.toGlobal({ x: 0, y: 0 });
        syncTooltipState({
          x: screenPos.x,
          y: screenPos.y - 45,
          text: tooltipTarget.text,
        });
      } else {
        tooltipTargetRef.current = null;
        syncTooltipState(null);
      }
    } else {
      syncTooltipState(null);
    }

    for (const [key, entity] of entityMap.entries()) {
      if (key.startsWith('session:')) {
        const sessionKey = key.replace('session:', '');
        if (!sessions[sessionKey]) {
          world.removeChild(entity);
          entityMap.delete(key);
          sessionBirthRef.current.delete(key);
        }
      }

      if (key.startsWith('agent:')) {
        const agentId = key.replace('agent:', '');
        if (!agents[agentId]) {
          world.removeChild(entity);
          entityMap.delete(key);
        }
      }

      if (key.startsWith('building:')) {
        const buildingId = key.replace('building:', '');
        if (!state.buildings?.some((building) => building.id === buildingId)) {
          world.removeChild(entity);
          entityMap.delete(key);
          buildingSmokeRef.current.delete(key);
        }
      }
    }
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {tooltipState && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-200 shadow-xl whitespace-nowrap transition-opacity"
          style={{ left: tooltipState.x, top: tooltipState.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltipState.text}
          <div className="absolute left-1/2 -bottom-1 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-slate-600 bg-slate-900/95" />
        </div>
      )}
      {/* Wall Tool Toolbar */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
        <button
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-lg border transition-all ${
            wallToolRef.current.active
              ? 'bg-amber-700 border-amber-500 text-white shadow-amber-500/30 ring-2 ring-amber-400/40'
              : 'bg-slate-800/90 border-slate-600 text-slate-300 hover:bg-slate-700'
          }`}
          title="🧱 围墙工具 (Esc 退出)&#10;▪ 空地拖动 = 铺砖&#10;▪ 砖上拖动 = 擦除&#10;▪ Shift = 直线&#10;▪ Ctrl+Z = 撤销"
          onClick={() => {
            wallToolRef.current.active = !wallToolRef.current.active;
            wallToolRef.current.painting = false;
            wallGhostPosRef.current = null;
            containerRef.current?.style.setProperty('--wall-tool', wallToolRef.current.active ? '1' : '0');
          }}
        >🧱</button>
        <button
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-lg border bg-slate-800/90 border-slate-600 text-slate-300 hover:bg-red-900/80"
          title="清除所有围墙"
          onClick={() => {
            wallBricksRef.current = new Set();
            wallBricksDirtyRef.current = true;
            void saveWalls(new Set());
          }}
        >🗑️</button>
        <button
          className="w-10 h-10 rounded-lg flex items-center justify-center text-sm shadow-lg border bg-slate-800/90 border-slate-600 text-slate-300 hover:bg-slate-700"
          title="重置视角 (R)"
          onClick={() => {
            if (worldRef.current) {
              worldRef.current.position.set(0, 0);
              worldRef.current.scale.set(1, 1);
            }
          }}
        >🔄</button>
      </div>
    </div>
  );
}
