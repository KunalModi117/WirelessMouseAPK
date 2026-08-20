import React from 'react';
import { View } from 'react-native';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function ClickButtons({ onSendClick }) {
  return (
    <View style={styles.clickBar}>
      <TactileButton style={styles.leftClickBtn} onPress={() => onSendClick('left')}>
        <View style={styles.clickIconIndicatorLeft} />
      </TactileButton>
      <View style={styles.clickDivider} />
      <TactileButton style={styles.rightClickBtn} onPress={() => onSendClick('right')}>
        <View style={styles.clickIconIndicatorRight} />
      </TactileButton>
    </View>
  );
}
