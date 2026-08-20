import React from 'react';
import { Text, View } from 'react-native';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function VolumeControls({ onSendVolume }) {
  return (
    <View style={styles.volumeGroup}>
      <TactileButton style={styles.volumeBtn} onPress={() => onSendVolume('down')}>
        <Text style={styles.volumeBtnIcon}>🔉</Text>
        <Text style={styles.volumeBtnSign}>-</Text>
      </TactileButton>
      <View style={styles.volumeDivider} />
      <TactileButton style={styles.volumeBtn} onPress={() => onSendVolume('up')}>
        <Text style={styles.volumeBtnIcon}>🔊</Text>
        <Text style={styles.volumeBtnSign}>+</Text>
      </TactileButton>
    </View>
  );
}
