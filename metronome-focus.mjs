export function initMetronomeFocus({start, stop, isPlaying, prepareAudio}) {
  const panel = document.getElementById('panel-metronome');
  const button = document.getElementById('metroFocus');
  const appbar = document.querySelector('.appbar');
  let expanded = false;
  const rail = document.getElementById('tempoRail');
  const weight = document.getElementById('visibleTempoWeight');
  let flick = null;
  // Catch touches on the stationary body as well as the moving arm.
  panel.addEventListener('pointerdown', event => {
    if (!expanded || !isPlaying() || !event.isPrimary || event.button !== 0 || button.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    flick = null;
    stop();
  }, true);
  panel.addEventListener('pointerdown', event => {
    if (!expanded || !event.isPrimary || event.button !== 0 || button.contains(event.target)) return;
    prepareAudio();
    const bounds = weight.getBoundingClientRect();
    if (event.clientX >= bounds.left - 14 && event.clientX <= bounds.right + 14 && event.clientY >= bounds.top - 14 && event.clientY <= bounds.bottom + 14) return;
    event.preventDefault();event.stopImmediatePropagation();
    flick = {id: event.pointerId, x: event.clientX, y: event.clientY};
    rail.setPointerCapture(event.pointerId);
  }, true);
  panel.addEventListener('pointermove', event => {
    if (flick?.id !== event.pointerId) return;
    event.preventDefault();event.stopImmediatePropagation();
  }, true);
  function releaseNeedle(event) {
    if (flick?.id !== event.pointerId) return;
    event.preventDefault();event.stopImmediatePropagation();
    const dx = event.clientX - flick.x, dy = event.clientY - flick.y;
    flick = null;
    if (event.type === 'pointercancel') return;
    if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy)) {
      if (!isPlaying()) start(dx > 0 ? 1 : -1);
    } else if (Math.hypot(dx,dy) < 10 && isPlaying()) stop();
  }
  panel.addEventListener('pointerup', releaseNeedle, true);
  panel.addEventListener('pointercancel', releaseNeedle, true);

  function setExpanded(value) {
    if (value === expanded) return;
    const mechanism = panel.querySelector('.mechanism');
    const before = mechanism.getBoundingClientRect();
    mechanism.getAnimations().forEach(animation => animation.cancel());
    expanded = value;
    panel.classList.toggle('metro-expanded', value);
    document.body.classList.toggle('metro-focus-open', value);
    appbar.inert = value;
    button.setAttribute('aria-pressed', String(value));
    button.setAttribute('aria-label', value ? '通常表示に戻す' : 'スマホをメトロノームにする');
    button.querySelector('span').textContent = value ? '戻る' : 'メト表示';
    window.dispatchEvent(new Event('resize'));
    // Animate the existing instrument, so its live needle is never duplicated.
    const after = mechanism.getBoundingClientRect();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && before.width && after.width) {
      mechanism.animate([
        {transformOrigin:'0 0',transform:`translate(${before.left-after.left}px,${before.top-after.top}px) scale(${before.width/after.width},${before.height/after.height})`},
        {transformOrigin:'0 0',transform:'none'}
      ], {duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  }

  function close() { setExpanded(false); }
  button.onclick = () => {
    setExpanded(!expanded);
    button.focus();
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expanded) close();
  });
  new MutationObserver(() => {
    if (panel.hidden && expanded) close();
  }).observe(panel, {attributes: true, attributeFilter: ['hidden']});
}
