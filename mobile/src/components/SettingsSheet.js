import React from 'react';
import { Modal, ScrollView, Switch, Text, View } from 'react-native';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function SettingsSheet({
  visible,
  onClose,
  connectionStatus,
  target,
  draftSettings,
  setDraftSettings,
  onSaveSettings,
  onOpenConnectionModal,
  onOpenBugModal
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheetContainer}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Settings</Text>
            <TactileButton onPress={onClose} style={styles.sheetCloseBtn}>
              <Text style={styles.sheetCloseText}>✕</Text>
            </TactileButton>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            {/* GROUP: CONNECTION */}
            <View style={styles.modalSection}>
              <Text style={styles.sectionHeading}>Connection</Text>
              <View style={styles.groupedContainer}>
                <View style={styles.groupedRow}>
                  <Text style={styles.groupedLabel}>Status</Text>
                  <Text style={styles.groupedValue}>
                    {connectionStatus === 'connected' ? `Connected (${target?.ip || 'PC'})` : 'Disconnected'}
                  </Text>
                </View>
                <View style={styles.groupedDivider} />
                <TactileButton
                  onPress={() => {
                    onClose();
                    onOpenConnectionModal();
                  }}
                  style={styles.groupedActionRow}
                >
                  <Text style={styles.groupedActionText}>Manage Connection</Text>
                  <Text style={styles.groupedChevron}>›</Text>
                </TactileButton>
              </View>
            </View>

            {/* GROUP: INPUT */}
            <View style={styles.modalSection}>
              <Text style={styles.sectionHeading}>Input</Text>
              <View style={styles.groupedContainer}>
                {/* Mouse Sensitivity */}
                <View style={styles.groupedRow}>
                  <Text style={styles.groupedLabel}>Mouse Sensitivity</Text>
                  <View style={styles.stepperRow}>
                    <TactileButton
                      onPress={() =>
                        setDraftSettings((curr) => ({
                          ...curr,
                          mouseSensitivity: Math.max(0.5, Math.round((curr.mouseSensitivity - 0.1) * 10) / 10)
                        }))
                      }
                      style={styles.stepperBtn}
                    >
                      <Text style={styles.stepperBtnText}>−</Text>
                    </TactileButton>
                    <Text style={styles.stepperVal}>{draftSettings.mouseSensitivity.toFixed(1)}x</Text>
                    <TactileButton
                      onPress={() =>
                        setDraftSettings((curr) => ({
                          ...curr,
                          mouseSensitivity: Math.min(3.0, Math.round((curr.mouseSensitivity + 0.1) * 10) / 10)
                        }))
                      }
                      style={styles.stepperBtn}
                    >
                      <Text style={styles.stepperBtnText}>+</Text>
                    </TactileButton>
                  </View>
                </View>

                <View style={styles.groupedDivider} />

                {/* Scroll Sensitivity */}
                <View style={styles.groupedRow}>
                  <Text style={styles.groupedLabel}>Scroll Sensitivity</Text>
                  <View style={styles.stepperRow}>
                    <TactileButton
                      onPress={() =>
                        setDraftSettings((curr) => ({
                          ...curr,
                          scrollSensitivity: Math.max(0.5, Math.round((curr.scrollSensitivity - 0.1) * 10) / 10)
                        }))
                      }
                      style={styles.stepperBtn}
                    >
                      <Text style={styles.stepperBtnText}>−</Text>
                    </TactileButton>
                    <Text style={styles.stepperVal}>{draftSettings.scrollSensitivity.toFixed(1)}x</Text>
                    <TactileButton
                      onPress={() =>
                        setDraftSettings((curr) => ({
                          ...curr,
                          scrollSensitivity: Math.min(3.0, Math.round((curr.scrollSensitivity + 0.1) * 10) / 10)
                        }))
                      }
                      style={styles.stepperBtn}
                    >
                      <Text style={styles.stepperBtnText}>+</Text>
                    </TactileButton>
                  </View>
                </View>

                <View style={styles.groupedDivider} />

                {/* Smooth Acceleration */}
                <View style={styles.groupedRow}>
                  <Text style={styles.groupedLabel}>Smooth Acceleration</Text>
                  <Switch
                    value={draftSettings.smoothAcceleration}
                    onValueChange={(val) => setDraftSettings((curr) => ({ ...curr, smoothAcceleration: val }))}
                    trackColor={{ false: '#334155', true: '#0a84ff' }}
                    thumbColor="#ffffff"
                  />
                </View>
              </View>
            </View>

            {/* GROUP: SUPPORT */}
            <View style={styles.modalSection}>
              <Text style={styles.sectionHeading}>Support</Text>
              <View style={styles.groupedContainer}>
                <TactileButton
                  onPress={() => {
                    onClose();
                    onOpenBugModal();
                  }}
                  style={styles.groupedActionRow}
                >
                  <Text style={styles.groupedActionText}>Report a Bug</Text>
                  <Text style={styles.groupedChevron}>›</Text>
                </TactileButton>
              </View>
            </View>

            {/* SAVE SETTINGS BUTTON */}
            <TactileButton onPress={onSaveSettings} style={styles.primaryActionBtn}>
              <Text style={styles.primaryActionText}>Save Settings</Text>
            </TactileButton>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
