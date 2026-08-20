import React from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function LogsSheet({
  visible,
  onClose,
  debugLogs,
  onCopyLogs
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.sheetBackdrop}>
        <View style={[styles.sheetContainer, { maxHeight: '88%' }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <View>
              <Text style={styles.sheetTitle}>Report a Bug</Text>
              <Text style={styles.sheetSubtitle}>Diagnostic & Connection Logs</Text>
            </View>
            <TactileButton onPress={onClose} style={styles.sheetCloseBtn}>
              <Text style={styles.sheetCloseText}>✕</Text>
            </TactileButton>
          </View>

          <View style={styles.logContainer}>
            <ScrollView contentContainerStyle={styles.logScrollContent}>
              {debugLogs.length === 0 ? (
                <Text style={styles.logEmptyText}>No diagnostic logs captured yet.</Text>
              ) : (
                debugLogs.map((entry) => (
                  <View key={entry.id} style={styles.logRow}>
                    <Text style={styles.logTime}>{entry.ts}</Text>
                    <Text
                      style={[
                        styles.logMsg,
                        entry.level === 'error'
                          ? styles.logMsgError
                          : entry.level === 'warn'
                            ? styles.logMsgWarn
                            : styles.logMsgInfo
                      ]}
                    >
                      {entry.level.toUpperCase()} {entry.message}
                    </Text>
                    {!!entry.details && <Text style={styles.logDetails}>{entry.details}</Text>}
                  </View>
                ))
              )}
            </ScrollView>
          </View>

          <View style={styles.logFooterRow}>
            <TactileButton onPress={onCopyLogs} style={styles.secondaryActionBtn}>
              <Text style={styles.secondaryActionText}>Copy Logs</Text>
            </TactileButton>
            <TactileButton onPress={onClose} style={styles.primaryActionBtnSmall}>
              <Text style={styles.primaryActionText}>Done</Text>
            </TactileButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}
