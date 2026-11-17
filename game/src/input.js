// input.js — keyboard + pointer-lock mouse input for EMBERLINE: Saltworks Yard.
// Tracks held keys, accumulates mouse-look deltas while pointer-locked, and
// reports whether the left mouse button is held (firing) while locked.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let locked = false;

  function setLocked(value) {
    locked = value;
    if (!locked) {
      keys.clear();
      firing = false;
    }
    if (typeof onLockChange === 'function') onLockChange(locked);
  }

  function onKeyDown(event) {
    if (event.code === 'Space') event.preventDefault();
    // Ignore auto-repeat: the Set already holds the code.
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onBlur() {
    keys.clear();
    firing = false;
  }

  function onMouseDown(event) {
    if (event.button === 0 && locked) firing = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) firing = false;
  }

  function onMouseMove(event) {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  }

  function onLockChangeEvent() {
    setLocked(document.pointerLockElement === canvas);
  }

  canvas.addEventListener('click', requestLock);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChangeEvent);

  function requestLock() {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  }

  // Returns accumulated look deltas since the last call, then clears them.
  function takeLook() {
    const out = { x: lookX, y: lookY };
    lookX = 0;
    lookY = 0;
    return out;
  }

  function destroy() {
    canvas.removeEventListener('click', requestLock);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChangeEvent);
  }

  return {
    keys,
    get firing() { return firing; },
    get locked() { return locked; },
    requestLock,
    takeLook,
    destroy,
  };
}
