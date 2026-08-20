import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

const GESTURE_IDLE = 'IDLE';
const GESTURE_TAP_WAIT = 'TAP_WAIT';
const GESTURE_DRAGGING = 'DRAGGING';

const DOUBLE_TAP_WINDOW_MS = 200;
const RIGHT_CLICK_WINDOW_MS = 450;

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

          if (multiTouchRef.current) {
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

          // Initial centroid initialization if missing
          if (!lastCentroidRef.current) {
            lastCentroidRef.current = centroid;
            return;
          }

          // -------------------------------------------------------------
          // MULTI-TOUCH / TWO-FINGER GESTURE PROCESSING
          // -------------------------------------------------------------
          if (multiTouchRef.current || currentCount >= 2) {
            // While BOTH fingers are active down:
            if (currentCount >= 2) {
              // 1-to-2 finger transition check
              if (lastCentroidRef.current.count < 2) {
                logGesture(`touchCount transition ${lastCentroidRef.current.count} -> ${currentCount}`);
                logGesture('baseline reset on 2nd finger arrival');

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

              if (totalDx > 5 || totalDy > 5) {
                movedRef.current = true;
                if (!scrollAxisRef.current) {
                  if (totalDx > 1.5 * totalDy) {
                    scrollAxisRef.current = 'H';
                  } else if (totalDy > 1.5 * totalDx) {
                    scrollAxisRef.current = 'V';
                  } else {
                    scrollAxisRef.current = 'D';
                  }
                  logGesture(`classified=${scrollAxisRef.current === 'H' ? 'HORIZONTAL_SCROLL' : scrollAxisRef.current === 'V' ? 'VERTICAL_SCROLL' : 'DIAGONAL_SCROLL'}`);
                }
              }

              if (movedRef.current) {
                if (scrollAxisRef.current === 'V') {
                  if (Math.abs(dy) > 0.01 && onScroll) onScroll(-dy * 3.0, 0);
                } else if (scrollAxisRef.current === 'H') {
                  if (Math.abs(dx) > 0.01 && onScroll) onScroll(0, dx * 3.0);
                } else if (scrollAxisRef.current === 'D') {
                  if ((Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) && onScroll) {
                    onScroll(-dy * 3.0, dx * 3.0);
                  }
                }
              }
              return;
            }

            // Finger release phase during multi-touch session (currentCount dropped to 1):
            // Do NOT compute centroid delta or set movedRef = true from 2->1 release jump!
            lastCentroidRef.current = centroid;
            return;
          }

          // -------------------------------------------------------------
          // SINGLE-FINGER MOUSE MOVEMENT & DRAGGING
          // -------------------------------------------------------------
          const dx = centroid.x - lastCentroidRef.current.x;
          const dy = centroid.y - lastCentroidRef.current.y;
          lastCentroidRef.current = centroid;

          accumScrollMoveRef.current.x += dx;
          accumScrollMoveRef.current.y += dy;

          const totalDx = Math.abs(accumScrollMoveRef.current.x);
          const totalDy = Math.abs(accumScrollMoveRef.current.y);

          if (totalDx > 3 || totalDy > 3) {
            movedRef.current = true;
          }

          if (movedRef.current && gestureStateRef.current === GESTURE_TAP_WAIT) {
            gestureStateRef.current = GESTURE_DRAGGING;
            logGesture('classified=DRAGGING');
            if (onDrag) onDrag(true, 'left');
          }

          if (Math.abs(dx) + Math.abs(dy) > 0.01) {
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
            `touchEnd moved=${movedRef.current} maxFingers=${finalFingers} duration=${duration}ms state=${gestureStateRef.current}`
          );

          if (gestureStateRef.current === GESTURE_DRAGGING) {
            if (onDrag) onDrag(false, 'left');
            gestureStateRef.current = GESTURE_IDLE;
          } else if (!movedRef.current) {
            // 2-FINGER TAP -> RIGHT CLICK
            if (finalFingers >= 2) {
              if (duration < RIGHT_CLICK_WINDOW_MS) {
                logGesture('classified=TWO_FINGER_TAP_RIGHT_CLICK');
                if (onClick) onClick('right');
              }
              gestureStateRef.current = GESTURE_IDLE;
            } else {
              // 1-FINGER TAP -> LEFT CLICK / DOUBLE TAP
              if (gestureStateRef.current === GESTURE_TAP_WAIT) {
                if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
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
          if (activeTouch) {
            scrollActiveTouchIdRef.current = activeTouch.identifier;
            scrollLastYRef.current = activeTouch.pageY;
            logGesture(`scrollStrip activeTouch=${activeTouch.identifier} y=${activeTouch.pageY}`);
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
            if (activeTouch) {
              scrollActiveTouchIdRef.current = activeTouch.identifier;
            }
          }

          if (!activeTouch) return;

          const currentY = activeTouch.pageY;
          if (scrollLastYRef.current === null) {
            scrollLastYRef.current = currentY;
            return;
          }

          const deltaY = currentY - scrollLastYRef.current;
          scrollLastYRef.current = currentY;
          if (Math.abs(deltaY) > 0.01) {
            if (onScroll) onScroll(-deltaY * 3.0, 0);
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
