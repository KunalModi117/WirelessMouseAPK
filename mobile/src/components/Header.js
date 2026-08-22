import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function Header({
  connectionStatus,
  keyboardVisible,
  onOpenConnectionModal,
  onToggleKeyboard,
  onOpenSettingsModal
}) {
  const getStatusDotStyle = (status) => {
    switch (status) {
      case 'connected':
        return styles.statusDotGreen;
      case 'connecting':
      case 'reconnecting':
        return styles.statusDotYellow;
      default:
        return styles.statusDotRed;
    }
  };

  return (
    <View style={styles.header}>
      <TactileButton style={styles.headerIconBtn} onPress={onOpenConnectionModal}>
        <View style={[styles.statusDot, getStatusDotStyle(connectionStatus)]} />
      </TactileButton>
      <View style={styles.headerRightActions}>
        <TactileButton
          style={[styles.headerIconBtn, keyboardVisible && styles.headerIconBtnActive]}
          onPress={onToggleKeyboard}
        >
          <Ionicons name="keypad-outline" size={20} color="#f8fafc" />
        </TactileButton>
        <TactileButton style={styles.headerIconBtn} onPress={onOpenSettingsModal}>
          <Ionicons name="settings-outline" size={20} color="#f8fafc" />
        </TactileButton>
      </View>
    </View>
  );
}

