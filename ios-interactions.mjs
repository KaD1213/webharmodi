// Motion decorates existing controls; audio timing and recording stay independent.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
document.addEventListener('pointerdown', event => {
  const button = event.target.closest('button:not(.key),a[download]');
  if (!button || button.disabled) return;
  button.classList.add('touch-down');
  const release = () => {
    button.classList.remove('touch-down');
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    window.removeEventListener('blur', release);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
});

for (const panel of document.querySelectorAll('[role=tabpanel]')) {
  new MutationObserver(records => {
    if (!records.some(r => r.attributeName === 'hidden') || panel.hidden || reduced.matches) return;
    panel.getAnimations().forEach(animation => animation.cancel());
    panel.animate([{opacity: .3}, {opacity: 1}], {duration: 160, easing: 'ease-out'});
  }).observe(panel, {attributes: true, attributeFilter: ['hidden']});
}

// Keep the focused settings row above the on-screen keyboard.
const sheet = document.getElementById('settingsDialog');
function fitKeyboard() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  sheet.style.setProperty('--keyboard-inset', Math.max(0, innerHeight - viewport.height - viewport.offsetTop) + 'px');
  if (sheet.open && sheet.contains(document.activeElement)) {
    document.activeElement.scrollIntoView({block: 'nearest', behavior: 'instant'});
  }
}
window.visualViewport?.addEventListener('resize', fitKeyboard);
sheet.addEventListener('focusin', () => setTimeout(fitKeyboard, 200));
sheet.addEventListener('close', () => sheet.style.removeProperty('--keyboard-inset'));

// Drag a segmented selection. A small tap retains its ordinary click action.
requestAnimationFrame(() => {for (const group of document.querySelectorAll('.tabs,.segments,.color-picker')) {
  let drag = null;
  group.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || !e.target.closest('button')) return;
    drag = {id: e.pointerId, x: e.clientX, y: e.clientY, moved: false};
  });
  group.addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y) > Math.abs(e.clientX - drag.x)) {drag = null; return;}
    if (Math.abs(e.clientX - drag.x) < 8 && !drag.moved) return;
    drag.moved = true; group.setPointerCapture(e.pointerId);
    const target = [...group.querySelectorAll(':scope > button:not([hidden])')].find(button => {
      const r = button.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right;
    });
    const thumb = group.querySelector('.thumb');
    if (target && thumb) {
      group.classList.add('selection-dragging');
      thumb.style.transform = `translate(${target.offsetLeft}px,${target.offsetTop}px)`;
      thumb.style.width = target.offsetWidth + 'px';
    }
  });
  function finish(e) {
    if (drag?.id !== e.pointerId) return;
    const moved = drag.moved; drag = null;
    group.classList.remove('selection-dragging');
    if (!moved) return;
    const buttons = [...group.querySelectorAll(':scope > button:not([hidden])')];
    const target = e.type === 'pointercancel' ? buttons.find(b => b.matches('[aria-selected=true],.active,[aria-pressed=true]')) : buttons.reduce((best, b) => {
      const r = b.getBoundingClientRect(); const distance = Math.abs(e.clientX - (r.left + r.width / 2));
      return !best || distance < best.distance ? {button: b, distance} : best;
    }, null)?.button;
    target?.click();
    target?.focus({preventScroll:true});
  }
  group.addEventListener('pointerup', finish);
  group.addEventListener('pointercancel', finish);
}});
