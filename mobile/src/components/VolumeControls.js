import React from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function VolumeControls({ onSendVolume }) {
  return (
    <View style={styles.volumeGroup}>
      <TactileButton style={styles.volumeBtn} onPress={() => onSendVolume('down')}>
        <Ionicons name="volume-low-outline" size={18} color="#94a3b8" />
        <Ionicons name="remove-outline" size={14} color="#64748b" />
      </TactileButton>
      <View style={styles.volumeDivider} />
      <TactileButton style={styles.volumeBtn} onPress={() => onSendVolume('up')}>
        <Ionicons name="volume-high-outline" size={18} color="#94a3b8" />
        <Ionicons name="add-outline" size={14} color="#64748b" />
      </TactileButton>
    </View>
  );
}

