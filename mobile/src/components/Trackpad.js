import React from 'react';
import { View } from 'react-native';
import { ScrollStrip } from './ScrollStrip';
import { styles } from '../styles/styles';

export function Trackpad({ trackpadResponder, scrollResponder }) {
  const trackpadPanHandlers = trackpadResponder?.panHandlers || {};
  return (
    <View style={styles.trackpadContainer}>
      <View style={styles.trackpadSurface} {...trackpadPanHandlers}>
        <View style={styles.trackpadInnerBorder} />
      </View>
      <ScrollStrip responder={scrollResponder} />
    </View>
  );
}
