import React from 'react';
import { Text, View } from 'react-native';
import { styles } from '../styles/styles';

export function ScrollStrip({ responder }) {
  const panHandlers = responder?.panHandlers || {};
  return (
    <View style={styles.integratedScrollStrip} {...panHandlers}>
      <Text style={styles.scrollChevron} pointerEvents="none">▲</Text>
      <View style={styles.scrollBarLine} pointerEvents="none" />
      <Text style={styles.scrollChevron} pointerEvents="none">▼</Text>
    </View>
  );
}
