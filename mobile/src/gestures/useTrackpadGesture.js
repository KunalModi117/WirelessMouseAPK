import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

const GESTURE_IDLE = 'IDLE';
const GESTURE_TAP_WAIT = 'TAP_WAIT';
const GESTURE_DRAGGING = 'DRAGGING';

const DOUBLE_TAP_WINDOW_MS = 200;
const RIGHT_CLICK_WINDOW_MS = 400;

export function getTouchCentroid(evt) {
  const touches = evt?.nativeEvent?.touches;
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
  const accumMoveRef = useRef({ x: 0, y: 0 });

  const lastTouchPosRef = useRef(null);
  const lastScrollYRef = useRef(null);
  const activeTouchIdRef = useRef(null);
  const maxFingersRef = useRef(0);
  const touchIdsRef = useRef(new Set());
  const movedRef = useRef(false);
  const multiTouchRef = useRef(false);

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
          lastTouchPosRef.current = centroid;
          touchStartTimeRef.current = Date.now();
          movedRef.current = false;
          scrollAxisRef.current = null;
          accumMoveRef.current = { x: 0, y: 0 };
          const count = centroid ? centroid.count : 1;
          if (onResetMoveCount) {
            onResetMoveCount(count);
          }

          touchIdsRef.current = new Set();
          const native = evt?.nativeEvent;
          if (native?.touches) {
            for (let i = 0; i < native.touches.length; i++) {
              if (native.touches[i].identifier !== undefined) {
                touchIdsRef.current.add(native.touches[i].identifier);
              }
            }
          }
          if (native?.changedTouches) {
            for (let i = 0; i < native.changedTouches.length; i++) {
              if (native.changedTouches[i].identifier !== undefined) {
                touchIdsRef.current.add(native.changedTouches[i].identifier);
              }
            }
          }

          const fingerCount = Math.max(count, touchIdsRef.current.size);
          maxFingersRef.current = fingerCount;
          multiTouchRef.current = fingerCount >= 2;

          if (!multiTouchRef.current && gestureStateRef.current === GESTURE_TAP_WAIT) {
            clearTimeout(doubleTapTimerRef.current);
          } else {
            gestureStateRef.current = GESTURE_IDLE;
          }

          logGesture(`touchStart fingers=${fingerCount}`);
        },
        onPanResponderMove: (evt) => {
          const centroid = getTouchCentroid(evt);
          if (!centroid) return;

          const native = evt?.nativeEvent;
          if (native?.touches) {
            for (let i = 0; i < native.touches.length; i++) {
              if (native.touches[i].identifier !== undefined) {
                touchIdsRef.current.add(native.touches[i].identifier);
              }
            }
          }
          if (native?.changedTouches) {
            for (let i = 0; i < native.changedTouches.length; i++) {
              if (native.changedTouches[i].identifier !== undefined) {
                touchIdsRef.current.add(native.changedTouches[i].identifier);
              }
            }
          }

          const currentFingers = Math.max(centroid.count, touchIdsRef.current.size);
          if (currentFingers > maxFingersRef.current) {
            maxFingersRef.current = currentFingers;
            logGesture(`maxFingers=${maxFingersRef.current}`);
          }

          if (currentFingers >= 2) {
            multiTouchRef.current = true;
          }

          if (!lastTouchPosRef.current || lastTouchPosRef.current.count !== centroid.count) {
            logGesture(
              `touchCount transition ${lastTouchPosRef.current ? lastTouchPosRef.current.count : 0} -> ${centroid.count}`
            );
            lastTouchPosRef.current = centroid;
            logGesture('baseline reset');
            accumMoveRef.current = { x: 0, y: 0 };
            scrollAxisRef.current = null;
            movedRef.current = false;
            return;
          }

          const dx = centroid.x - lastTouchPosRef.current.x;
          const dy = centroid.y - lastTouchPosRef.current.y;
          lastTouchPosRef.current = centroid;

          accumMoveRef.current.x += dx;
          accumMoveRef.current.y += dy;

          const totalDx = Math.abs(accumMoveRef.current.x);
          const totalDy = Math.abs(accumMoveRef.current.y);

          if (multiTouchRef.current) {
            if (totalDx > 10 || totalDy > 10) {
              movedRef.current = true;
              if (!scrollAxisRef.current) {
                scrollAxisRef.current = totalDx > totalDy ? 'H' : 'V';
                logGesture(
                  `classified=${scrollAxisRef.current === 'H' ? 'HORIZONTAL_SCROLL' : 'VERTICAL_SCROLL'}`
                );
              }
            }
            if (movedRef.current) {
              if (scrollAxisRef.current === 'V' && Math.abs(dy) > 0.1) {
                if (onScroll) onScroll(-dy * 2.5, 0);
              } else if (scrollAxisRef.current === 'H' && Math.abs(dx) > 0.1) {
                if (onScroll) onScroll(0, dx * 2.5);
              }
            }
            return;
          }

          if (totalDx > 4 || totalDy > 4) {
            movedRef.current = true;
          }

          if (movedRef.current && gestureStateRef.current === GESTURE_TAP_WAIT) {
            gestureStateRef.current = GESTURE_DRAGGING;
            logGesture('classified=DRAGGING');
            if (onDrag) onDrag(true, 'left');
          }

          if (Math.abs(dx) + Math.abs(dy) > 0.1) {
            if (onMove) onMove(dx, dy);
          } else {
            if (onIncrementLostTouch) onIncrementLostTouch();
          }
        },
        onPanResponderRelease: (evt) => {
          if (onFlushMove) onFlushMove();
          const duration = Date.now() - touchStartTimeRef.current;

          const native = evt?.nativeEvent;
          if (native?.touches) {
            for (let i = 0; i < native.touches.length; i++) {
              if (native.touches[i].identifier !== undefined) {
                touchIdsRef.current.add(native.touches[i].identifier);
              }
            }
          }
          if (native?.changedTouches) {
            for (let i = 0; i < native.changedTouches.length; i++) {
              if (native.changedTouches[i].identifier !== undefined) {
                touchIdsRef.current.add(native.changedTouches[i].identifier);
              }
            }
          }
          const finalFingers = Math.max(maxFingersRef.current, touchIdsRef.current.size);

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
          lastTouchPosRef.current = null;
        },
        onPanResponderTerminate: () => {
          if (onFlushMove) onFlushMove();
          if (gestureStateRef.current === GESTURE_DRAGGING) {
            if (onDrag) onDrag(false, 'left');
          }
          gestureStateRef.current = GESTURE_IDLE;
          lastTouchPosRef.current = null;
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
          const activeTouch =
            evt?.nativeEvent?.changedTouches?.[0] || evt?.nativeEvent?.touches?.[0];
          if (activeTouch) {
            activeTouchIdRef.current = activeTouch.identifier;
            lastScrollYRef.current = activeTouch.pageY;
            logGesture(`scrollStrip activeTouch=${activeTouch.identifier}`);
          } else {
            activeTouchIdRef.current = null;
            lastScrollYRef.current = null;
          }
        },
        onPanResponderMove: (evt) => {
          const touches = evt?.nativeEvent?.touches || [];
          const changed = evt?.nativeEvent?.changedTouches || [];
          const activeTouch =
            touches.find((t) => t.identifier === activeTouchIdRef.current) ||
            changed.find((t) => t.identifier === activeTouchIdRef.current) ||
            touches[0] ||
            changed[0];
          const currentY = activeTouch ? activeTouch.pageY : null;
          if (currentY === null || lastScrollYRef.current === null) {
            lastScrollYRef.current = currentY;
            return;
          }
          const delta = currentY - lastScrollYRef.current;
          lastScrollYRef.current = currentY;
          if (Math.abs(delta) > 0.1) {
            if (onScroll) onScroll(-delta * 2.5, 0);
          }
        },
        onPanResponderRelease: () => {
          activeTouchIdRef.current = null;
          lastScrollYRef.current = null;
        },
        onPanResponderTerminate: () => {
          activeTouchIdRef.current = null;
          lastScrollYRef.current = null;
        }
      }),
    [onScroll, onLog]
  );

  return {
    trackpadResponder,
    scrollResponder
  };
}
