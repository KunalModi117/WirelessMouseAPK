import React from 'react';
import { Text, View } from 'react-native';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function DirectionPad({ onSendKey }) {
  return (
    <View style={styles.bottomPadGrid}>
      <TactileButton style={styles.dPadLargeBtn} onPress={() => onSendKey('Left')}>
        <Text style={styles.dPadArrowText}>◀</Text>
      </TactileButton>
      <View style={styles.dPadCenterCol}>
        <TactileButton style={styles.dPadHalfBtnTop} onPress={() => onSendKey('Up')}>
          <Text style={styles.dPadArrowText}>▲</Text>
        </TactileButton>
        <View style={styles.dPadCenterDivider} />
        <TactileButton style={styles.dPadHalfBtnBottom} onPress={() => onSendKey('Down')}>
          <Text style={styles.dPadArrowText}>▼</Text>
        </TactileButton>
      </View>
      <TactileButton style={styles.dPadLargeBtn} onPress={() => onSendKey('Right')}>
        <Text style={styles.dPadArrowText}>▶</Text>
      </TactileButton>
    </View>
  );
}
