import React from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { TactileButton } from './TactileButton';
import { styles } from '../styles/styles';

export function ConnectionSheet({
  visible,
  onClose,
  connectionStatus,
  connectedHost,
  discovered,
  discoveryEnabled = true,
  manualDraft,
  setManualDraft,
  onConnectDiscovered,
  onDisconnect,
  onSaveManual
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
            <Text style={styles.sheetTitle}>Connection</Text>
            <TactileButton onPress={onClose} style={styles.sheetCloseBtn}>
              <Text style={styles.sheetCloseText}>✕</Text>
            </TactileButton>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            {/* CURRENT STATUS */}
            <View style={styles.modalSection}>
              <Text style={styles.sectionHeading}>Current Status</Text>
              <View style={styles.statusCard}>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      connectionStatus === 'connected'
                        ? styles.statusDotGreen
                        : connectionStatus === 'connecting'
                          ? styles.statusDotYellow
                          : styles.statusDotRed
                    ]}
                  />
                  <Text style={styles.statusStateText}>
                    {connectionStatus === 'connected'
                      ? `Connected`
                      : connectionStatus === 'connecting'
                        ? 'Connecting...'
                        : 'Disconnected'}
                  </Text>
                </View>
                {connectionStatus === 'connected' && !!connectedHost && (
                  <Text style={styles.statusHostText}>{connectedHost}</Text>
                )}
                {connectionStatus === 'connected' && (
                  <TactileButton
                    onPress={onDisconnect}
                    style={styles.disconnectBtn}
                  >
                    <Text style={styles.disconnectBtnText}>Disconnect</Text>
                  </TactileButton>
                )}
              </View>
            </View>

            {/* DISCOVERED DEVICES */}
            <View style={styles.modalSection}>
              <Text style={styles.sectionHeading}>Discovered PCs</Text>
              {discovered.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyCardText}>
                    {discoveryEnabled
                      ? 'Scanning local Wi-Fi subnet for PC server...'
                      : 'Discovery disabled. Enter IP below.'}
                  </Text>
                </View>
              ) : (
                discovered.map((item, index) => (
                  <TactileButton
                    key={`${item.deviceId || item.ip}:${item.wsPort}`}
                    onPress={() => onConnectDiscovered(index)}
                    style={styles.discoveredRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.discoveredIpText}>
                        {item.host ? `🖥️ ${item.host}` : item.ip}
                      </Text>
                      <Text style={styles.discoveredMetaText}>
                        {item.platform ? `${item.platform} · Available` : 'Available'}
                      </Text>
                    </View>
                    <View style={styles.connectPill}>
                      <Text style={styles.connectPillText}>Connect</Text>
                    </View>
                  </TactileButton>
                ))
              )}
            </View>

            {/* MANUAL ENTRY */}
            <View style={styles.modalSection}>
              <Text style={styles.sectionHeading}>Manual Connection</Text>
              <View style={styles.manualCard}>
                <Text style={styles.fieldLabel}>PC IP Address</Text>
                <TextInput
                  value={manualDraft.ip}
                  onChangeText={(val) => setManualDraft((curr) => ({ ...curr, ip: val }))}
                  placeholder="e.g. 192.168.1.100"
                  placeholderTextColor="#475569"
                  keyboardType="numeric"
                  style={styles.inputField}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>WS Port</Text>
                    <TextInput
                      value={manualDraft.wsPort}
                      onChangeText={(val) => setManualDraft((curr) => ({ ...curr, wsPort: val }))}
                      placeholder="41235"
                      placeholderTextColor="#475569"
                      keyboardType="numeric"
                      style={styles.inputField}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>UDP Port</Text>
                    <TextInput
                      value={manualDraft.udpMovePort}
                      onChangeText={(val) => setManualDraft((curr) => ({ ...curr, udpMovePort: val }))}
                      placeholder="41236"
                      placeholderTextColor="#475569"
                      keyboardType="numeric"
                      style={styles.inputField}
                    />
                  </View>
                </View>

                <TactileButton onPress={onSaveManual} style={styles.primaryActionBtn}>
                  <Text style={styles.primaryActionText}>Connect to IP</Text>
                </TactileButton>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
