// Shared video-effect definitions (used by popup.html preview and offscreen.html recorder).
const VREffects = (() => {
  const PRESETS = {
    none:      { name: 'None',          filter: '' },
    grayscale: { name: 'Black & white', filter: 'grayscale(1)' },
    noir:      { name: 'Noir',          filter: 'grayscale(1) contrast(1.5) brightness(0.9)' },
    sepia:     { name: 'Sepia',         filter: 'sepia(1)' },
    vintage:   { name: 'Vintage',       filter: 'sepia(0.5) contrast(1.1) saturate(0.8) brightness(1.05)' },
    warm:      { name: 'Warm',          filter: 'sepia(0.25) saturate(1.3) hue-rotate(-10deg)' },
    cool:      { name: 'Cool',          filter: 'saturate(1.1) hue-rotate(20deg) brightness(1.03)' },
    vivid:     { name: 'Vivid',         filter: 'saturate(1.8) contrast(1.1)' },
    dramatic:  { name: 'Dramatic',      filter: 'contrast(1.4) saturate(1.3) brightness(0.95)' },
    faded:     { name: 'Faded',         filter: 'contrast(0.8) saturate(0.6) brightness(1.1)' },
    invert:    { name: 'Invert',        filter: 'invert(1)' },
  };

  const DEFAULTS = {
    preset: 'none',
    brightness: 100, // %
    contrast: 100,   // %
    saturation: 100, // %
    hue: 0,          // deg
    blur: 0,         // px (CSS px; scaled to video resolution)
    vignette: 0,     // 0..100 strength
    grain: 0,        // 0..100 strength
    pixelate: 0,     // block size in CSS px, 0 = off
  };

  /** CSS/canvas filter string for the given effects. `scale` converts CSS px → video px for blur. */
  function buildFilter(fx, scale = 1) {
    if (!fx) return 'none';
    const parts = [];
    const p = PRESETS[fx.preset];
    if (p && p.filter) parts.push(p.filter);
    if (fx.brightness != null && +fx.brightness !== 100) parts.push(`brightness(${fx.brightness / 100})`);
    if (fx.contrast != null && +fx.contrast !== 100) parts.push(`contrast(${fx.contrast / 100})`);
    if (fx.saturation != null && +fx.saturation !== 100) parts.push(`saturate(${fx.saturation / 100})`);
    if (+fx.hue) parts.push(`hue-rotate(${fx.hue}deg)`);
    if (+fx.blur > 0) parts.push(`blur(${(fx.blur * scale).toFixed(2)}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  function isActive(fx) {
    if (!fx) return false;
    return buildFilter(fx) !== 'none' || +fx.vignette > 0 || +fx.grain > 0 || +fx.pixelate > 0;
  }

  /**
   * Build a per-recording renderer. drawFrame(ctx, source, [sx,sy,sw,sh]) draws the
   * cropped source (VideoFrame, canvas, image...) into a W×H ctx with all effects applied.
   * `scale` converts CSS px (blur / pixelate sizes) to output px.
   */
  function create(fxOpts, W, H, scale) {
    const fx = { ...DEFAULTS, ...(fxOpts || {}) };
    const filter = buildFilter(fx, scale);
    const blur = +fx.blur > 0;

    // Pixelation: render into a tiny canvas, then scale up without smoothing.
    let pix = null;
    const block = Math.round((+fx.pixelate || 0) * scale);
    if (block >= 2) {
      const c = new OffscreenCanvas(Math.max(1, Math.ceil(W / block)), Math.max(1, Math.ceil(H / block)));
      pix = { c, ctx: c.getContext('2d') };
    }

    // Vignette: precomputed radial gradient.
    let vignette = null;
    if (+fx.vignette > 0) {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d');
      const r = Math.hypot(W, H) / 2;
      const grad = g.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${Math.min(1, fx.vignette / 100) * 0.95})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      vignette = c;
    }

    // Film grain: a few pre-generated noise tiles, cycled per frame.
    let grain = null;
    if (+fx.grain > 0) {
      const T = 256;
      const tiles = [];
      for (let k = 0; k < 4; k++) {
        const c = new OffscreenCanvas(T, T);
        const g = c.getContext('2d');
        const img = g.createImageData(T, T);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        tiles.push(c);
      }
      grain = { tiles, i: 0, alpha: Math.min(1, fx.grain / 100) * 0.35 };
    }

    return {
      drawFrame(ctx, frame, [sx, sy, sw, sh]) {
        ctx.save();
        if (pix) {
          pix.ctx.filter = filter;
          pix.ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, pix.c.width, pix.c.height);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(pix.c, 0, 0, pix.c.width, pix.c.height, 0, 0, pix.c.width * block, pix.c.height * block);
        } else {
          // With blur, draw an unblurred copy underneath so edges don't fade to black.
          if (blur) ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, W, H);
          ctx.filter = filter;
          ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, W, H);
        }
        ctx.restore();

        if (grain) {
          const tile = grain.tiles[grain.i = (grain.i + 1) % grain.tiles.length];
          ctx.save();
          ctx.globalAlpha = grain.alpha;
          ctx.globalCompositeOperation = 'overlay';
          ctx.fillStyle = ctx.createPattern(tile, 'repeat');
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
        if (vignette) ctx.drawImage(vignette, 0, 0);
      },
    };
  }

  return { PRESETS, DEFAULTS, buildFilter, isActive, create };
})();
