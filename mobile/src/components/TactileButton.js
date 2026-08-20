import React from 'react';
import { Pressable } from 'react-native';
import { styles } from '../styles/styles';

/**
 * Reusable Tactile Button following Apple design principles:
 * Instant touch-down feedback, critically damped scaling, and strong visual feedback.
 */
export function TactileButton({
  onPress,
  onPressIn,
  onPressOut,
  style,
  pressedStyle,
  children,
  activeOpacity = 0.8,
  scaleDown = 0.97
}) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        style,
        pressed && [
          styles.tactilePressed,
          { transform: [{ scale: scaleDown }], opacity: activeOpacity },
          pressedStyle
        ]
      ]}
    >
      {children}
    </Pressable>
  );
}
