import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

const GESTURE_IDLE = 'IDLE';
const GESTURE_TAP_WAIT = 'TAP_WAIT';
const GESTURE_DRAGGING = 'DRAGGING';

const DOUBLE_TAP_WINDOW_MS = 200;
const RIGHT_CLICK_WINDOW_MS = 400;

export function extractTouches(evt) {
  const native = evt?.nativeEvent;
  if (!native) return [];
  const touches = native.touches || [];
  if (touches.length > 0) {
    return touches;
  }
  return native.changedTouches || [];
}

export function getTouchCentroid(evt) {
  const touches = extractTouches(evt);
  if (!touches || touches.length === 0) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < touches.length; i += 1) {
    sumX += touches[i].pageX;
    sumY += touches[i].pageY;
  }
  return {
    x: sumX / touches.length,
    y: sumY / touches.length,
    count: touches.length
  };
}

export function useTrackpadGesture({
  onMove,
  onFlushMove,
  onResetMoveCount,
  onIncrementLostTouch,
  onClick,
  onScroll,
  onDrag,
  onLog
}) {
  const gestureStateRef = useRef(GESTURE_IDLE);
  const doubleTapTimerRef = useRef(null);
  const touchStartTimeRef = useRef(0);

  const scrollAxisRef = useRef(null);
  const accumScrollMoveRef = useRef({ x: 0, y: 0 });

  const lastCentroidRef = useRef(null);
  const maxFingersRef = useRef(0);
  const movedRef = useRef(false);
  const multiTouchRef = useRef(false);

  const scrollActiveTouchIdRef = useRef(null);
  const scrollLastYRef = useRef(null);

  function logGesture(msg) {
    if (onLog) {
      onLog('info', '[GESTURE]', msg);
    }
  }

  const trackpadResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const centroid = getTouchCentroid(evt);
          lastCentroidRef.current = centroid;
          touchStartTimeRef.current = Date.now();
          movedRef.current = false;
          scrollAxisRef.current = null;
          accumScrollMoveRef.current = { x: 0, y: 0 };
          const count = centroid ? centroid.count : 1;
          maxFingersRef.current = count;
          multiTouchRef.current = count >= 2;

          if (onResetMoveCount) {
            onResetMoveCount(count);
          }

          if (!multiTouchRef.current && gestureStateRef.current === GESTURE_TAP_WAIT) {
            // Keep wait state for potential double-tap drag
          } else {
            gestureStateRef.current = GESTURE_IDLE;
          }

          logGesture(`touchStart fingers=${count}`);
        },
        onPanResponderMove: (evt) => {
          const centroid = getTouchCentroid(evt);
          if (!centroid) return;

          const currentCount = centroid.count;
          if (currentCount > maxFingersRef.current) {
            maxFingersRef.current = currentCount;
            logGesture(`maxFingers=${maxFingersRef.current}`);
          }

          if (currentCount >= 2) {
            multiTouchRef.current = true;
          }

          // TRANSITION CHECK: finger count transition or arrival of second finger
          if (!lastCentroidRef.current || lastCentroidRef.current.count !== currentCount) {
            const prevCount = lastCentroidRef.current ? lastCentroidRef.current.count : 0;
            logGesture(`touchCount transition ${prevCount} -> ${currentCount}`);
            logGesture('baseline reset');

            // Establish fresh baseline on transition
            lastCentroidRef.current = centroid;
            accumScrollMoveRef.current = { x: 0, y: 0 };
            scrollAxisRef.current = null;
            movedRef.current = false;

            if (onResetMoveCount) {
              onResetMoveCount(currentCount);
            }
            return;
          }

          const dx = centroid.x - lastCentroidRef.current.x;
          const dy = centroid.y - lastCentroidRef.current.y;
          lastCentroidRef.current = centroid;

          accumScrollMoveRef.current.x += dx;
          accumScrollMoveRef.current.y += dy;

          const totalDx = Math.abs(accumScrollMoveRef.current.x);
          const totalDy = Math.abs(accumScrollMoveRef.current.y);

          // Handle Multi-Touch Scroll (Two-finger)
          if (multiTouchRef.current || currentCount >= 2) {
            if (totalDx > 6 || totalDy > 6) {
              movedRef.current = true;
              if (!scrollAxisRef.current) {
                if (totalDx > 1.8 * totalDy) {
                  scrollAxisRef.current = 'H';
                } else if (totalDy > 1.8 * totalDx) {
                  scrollAxisRef.current = 'V';
                } else {
                  scrollAxisRef.current = 'D';
                }
                logGesture(`classified=${scrollAxisRef.current === 'H' ? 'HORIZONTAL_SCROLL' : scrollAxisRef.current === 'V' ? 'VERTICAL_SCROLL' : 'DIAGONAL_SCROLL'}`);
              }
            }

            if (movedRef.current) {
              if (scrollAxisRef.current === 'V' && Math.abs(dy) > 0.05) {
                if (onScroll) onScroll(-dy * 2.5, 0);
              } else if (scrollAxisRef.current === 'H' && Math.abs(dx) > 0.05) {
                if (onScroll) onScroll(0, dx * 2.5);
              } else if (scrollAxisRef.current === 'D' && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
                if (onScroll) onScroll(-dy * 2.5, dx * 2.5);
              }
            }
            return;
          }

          // Handle Single-Finger Mouse Movement & Dragging
          if (totalDx > 4 || totalDy > 4) {
            movedRef.current = true;
          }

          if (movedRef.current && gestureStateRef.current === GESTURE_TAP_WAIT) {
            gestureStateRef.current = GESTURE_DRAGGING;
            logGesture('classified=DRAGGING');
            if (onDrag) onDrag(true, 'left');
          }

          if (Math.abs(dx) + Math.abs(dy) > 0.05) {
            if (onMove) onMove(dx, dy);
          } else {
            if (onIncrementLostTouch) onIncrementLostTouch();
          }
        },
        onPanResponderRelease: (evt) => {
          if (onFlushMove) onFlushMove();
          const duration = Date.now() - touchStartTimeRef.current;
          const finalFingers = maxFingersRef.current;

          logGesture(
            `touchEnd moved=${movedRef.current} maxFingers=${finalFingers} state=${gestureStateRef.current}`
          );

          if (gestureStateRef.current === GESTURE_DRAGGING) {
            if (onDrag) onDrag(false, 'left');
            gestureStateRef.current = GESTURE_IDLE;
          } else if (!movedRef.current) {
            if (finalFingers >= 2) {
              if (duration < RIGHT_CLICK_WINDOW_MS) {
                logGesture('classified=TWO_FINGER_TAP');
                if (onClick) onClick('right');
              }
              gestureStateRef.current = GESTURE_IDLE;
            } else {
              if (gestureStateRef.current === GESTURE_TAP_WAIT) {
                logGesture('classified=DOUBLE_TAP');
                if (onClick) onClick('left');
                setTimeout(() => {
                  if (onClick) onClick('left');
                }, 50);
                gestureStateRef.current = GESTURE_IDLE;
              } else {
                if (duration < 250) {
                  gestureStateRef.current = GESTURE_TAP_WAIT;
                  doubleTapTimerRef.current = setTimeout(() => {
                    if (gestureStateRef.current === GESTURE_TAP_WAIT) {
                      logGesture('classified=SINGLE_TAP');
                      if (onClick) onClick('left');
                      gestureStateRef.current = GESTURE_IDLE;
                    }
                  }, DOUBLE_TAP_WINDOW_MS);
                } else {
                  if (onClick) onClick('left');
                  gestureStateRef.current = GESTURE_IDLE;
                }
              }
            }
          } else {
            gestureStateRef.current = GESTURE_IDLE;
          }
          lastCentroidRef.current = null;
        },
        onPanResponderTerminate: () => {
          if (onFlushMove) onFlushMove();
          if (gestureStateRef.current === GESTURE_DRAGGING) {
            if (onDrag) onDrag(false, 'left');
          }
          gestureStateRef.current = GESTURE_IDLE;
          lastCentroidRef.current = null;
        }
      }),
    [
      onMove,
      onFlushMove,
      onResetMoveCount,
      onIncrementLostTouch,
      onClick,
      onScroll,
      onDrag,
      onLog
    ]
  );

  const scrollResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touches = extractTouches(evt);
          const activeTouch = touches[0];
          if (activeTouch && activeTouch.identifier !== undefined) {
            scrollActiveTouchIdRef.current = activeTouch.identifier;
            scrollLastYRef.current = activeTouch.pageY;
            logGesture(`scrollStrip activeTouch=${activeTouch.identifier}`);
          } else {
            scrollActiveTouchIdRef.current = null;
            scrollLastYRef.current = null;
          }
        },
        onPanResponderMove: (evt) => {
          const touches = extractTouches(evt);
          if (touches.length === 0) return;

          let activeTouch = null;
          if (scrollActiveTouchIdRef.current !== null && scrollActiveTouchIdRef.current !== undefined) {
            activeTouch = touches.find((t) => t.identifier === scrollActiveTouchIdRef.current);
          }
          if (!activeTouch) {
            activeTouch = touches[0];
            if (activeTouch && activeTouch.identifier !== undefined) {
              scrollActiveTouchIdRef.current = activeTouch.identifier;
            }
          }

          const currentY = activeTouch ? activeTouch.pageY : null;
          if (currentY === null || scrollLastYRef.current === null) {
            scrollLastYRef.current = currentY;
            return;
          }

          const delta = currentY - scrollLastYRef.current;
          scrollLastYRef.current = currentY;
          if (Math.abs(delta) > 0.05) {
            if (onScroll) onScroll(-delta * 2.5, 0);
          }
        },
        onPanResponderRelease: () => {
          scrollActiveTouchIdRef.current = null;
          scrollLastYRef.current = null;
        },
        onPanResponderTerminate: () => {
          scrollActiveTouchIdRef.current = null;
          scrollLastYRef.current = null;
        }
      }),
    [onScroll, onLog]
  );

  return {
    trackpadResponder,
    scrollResponder
  };
}
