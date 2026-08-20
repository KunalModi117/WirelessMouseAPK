import 'react-native-gesture-handler';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { styles } from './src/styles/styles';
import { useSettings } from './src/hooks/useSettings';
import { useConnection } from './src/hooks/useConnection';
import { useTrackpadGesture } from './src/gestures/useTrackpadGesture';

import { Header } from './src/components/Header';
import { VolumeControls } from './src/components/VolumeControls';
import { Trackpad } from './src/components/Trackpad';
import { ClickButtons } from './src/components/ClickButtons';
import { DirectionPad } from './src/components/DirectionPad';
import { ConnectionSheet } from './src/components/ConnectionSheet';
import { SettingsSheet } from './src/components/SettingsSheet';
import { LogsSheet } from './src/components/LogsSheet';

export default function App() {
  const {
    settings,
    draftSettings,
    setDraftSettings,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    saveSettings
  } = useSettings();

  const connection = useConnection({ settings });

  const { trackpadResponder, scrollResponder } = useTrackpadGesture({
    onMove: connection.sendMove,
    onFlushMove: connection.flushPendingMove,
    onResetMoveCount: (count) => {
      connection.pendingMoveRef.current = { x: 0, y: 0, touchCount: count };
    },
    onIncrementLostTouch: () => {
      connection.touchDiagRef.current.lost += 1;
    },
    onClick: connection.sendClick,
    onScroll: connection.sendScroll,
    onDrag: connection.sendDrag,
    onLog: connection.addDebugLog
  });

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe}>
          <View style={styles.shell}>
            <Header
              connectionStatus={connection.connectionStatus}
              keyboardVisible={connection.keyboardVisible}
              onOpenConnectionModal={connection.openConnectionModal}
              onToggleKeyboard={() => connection.setKeyboardVisible((prev) => !prev)}
              onOpenSettingsModal={openSettings}
            />

            <VolumeControls onSendVolume={connection.sendVolume} />

            {!!connection.lastError && (
              <Pressable
                onPress={() => connection.setLastError('')}
                style={styles.errorBanner}
              >
                <Text style={styles.errorBannerText}>{connection.lastError}</Text>
              </Pressable>
            )}

            <Trackpad
              trackpadResponder={trackpadResponder}
              scrollResponder={scrollResponder}
            />

            <ClickButtons onSendClick={connection.sendClick} />

            <DirectionPad onSendKey={connection.sendKey} />

            {connection.keyboardVisible && (
              <TextInput
                ref={connection.hiddenInputRef}
                value={connection.inputValue}
                onChangeText={connection.handleTextChange}
                onKeyPress={connection.handleHiddenKeyPress}
                onSubmitEditing={() => connection.sendKey('Enter')}
                returnKeyType="send"
                style={styles.hiddenInput}
                autoCapitalize="none"
                autoCorrect={false}
                blurOnSubmit={false}
                placeholder=""
              />
            )}
          </View>
        </SafeAreaView>

        <ConnectionSheet
          visible={connection.connectionModalOpen}
          onClose={() => connection.setConnectionModalOpen(false)}
          connectionStatus={connection.connectionStatus}
          connectedHost={connection.connectedHost}
          discovered={connection.discovered}
          discoveryStatus={connection.discoveryStatus}
          onRefreshDiscovery={connection.refreshDiscovery}
          manualDraft={connection.manualDraft}
          setManualDraft={connection.setManualDraft}
          onConnectDiscovered={connection.connectDiscovered}
          onDisconnect={() => {
            connection.disconnectSocket();
            connection.setConnectionStatus('disconnected');
          }}
          onSaveManual={connection.saveManual}
        />

        <SettingsSheet
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          connectionStatus={connection.connectionStatus}
          target={connection.target}
          draftSettings={draftSettings}
          setDraftSettings={setDraftSettings}
          onSaveSettings={saveSettings}
          onOpenConnectionModal={connection.openConnectionModal}
          onOpenBugModal={() => connection.setBugModalOpen(true)}
        />

        <LogsSheet
          visible={connection.bugModalOpen}
          onClose={() => connection.setBugModalOpen(false)}
          debugLogs={connection.debugLogs}
          onCopyLogs={connection.copyDebugLogs}
        />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
