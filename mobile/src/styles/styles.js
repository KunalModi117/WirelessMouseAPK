import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07090e'
  },
  safe: {
    flex: 1
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10
  },

  /* HEADER */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 4
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#131926',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  headerIconBtnActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.25)',
    borderColor: '#0a84ff'
  },
  headerIconText: {
    color: '#f8fafc',
    fontSize: 18
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6
  },
  statusDotGreen: {
    backgroundColor: '#34c759',
    shadowColor: '#34c759',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6
  },
  statusDotYellow: {
    backgroundColor: '#ff9500'
  },
  statusDotRed: {
    backgroundColor: '#ff3b30'
  },

  /* COMPACT VOLUME CONTROLS */
  volumeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    backgroundColor: '#121824',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  volumeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 6
  },
  volumeBtnIcon: {
    fontSize: 15
  },
  volumeBtnSign: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '600'
  },
  volumeDivider: {
    width: 1,
    height: '60%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },

  /* ERROR BANNER */
  errorBanner: {
    backgroundColor: 'rgba(255, 59, 48, 0.18)',
    borderWidth: 1,
    borderColor: '#ff3b30',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  errorBannerText: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500'
  },

  /* MAIN TRACKPAD SURFACE */
  trackpadContainer: {
    flex: 1,
    minHeight: 260,
    borderRadius: 24,
    backgroundColor: '#0c111c',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    position: 'relative'
  },
  trackpadSurface: {
    flex: 1,
    width: '100%',
    height: '100%'
  },
  trackpadInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 24,
    pointerEvents: 'none'
  },
  integratedScrollStrip: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 42,
    zIndex: 10,
    elevation: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20
  },
  scrollChevron: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700'
  },
  scrollBarLine: {
    width: 2,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 1
  },

  /* CLICK BAR */
  clickBar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: '#121824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  leftClickBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rightClickBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  clickDivider: {
    width: 1,
    height: '60%',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },
  clickIconIndicatorLeft: {
    width: 24,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#475569',
    borderLeftWidth: 3
  },
  clickIconIndicatorRight: {
    width: 24,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#475569',
    borderRightWidth: 3
  },

  /* BOTTOM DIRECTIONAL & KEYBOARD CONTROLS */
  bottomPadGrid: {
    flexDirection: 'row',
    height: 110,
    gap: 8
  },
  dPadLargeBtn: {
    flex: 1,
    backgroundColor: '#121824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  dPadCenterCol: {
    flex: 1,
    backgroundColor: '#121824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  dPadHalfBtnTop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dPadHalfBtnBottom: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dPadCenterDivider: {
    height: 1,
    width: '70%',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },
  dPadArrowText: {
    color: '#cbd5e1',
    fontSize: 18,
    fontWeight: '600'
  },
  dPadSubIcon: {
    color: '#64748b',
    fontSize: 13
  },

  tactilePressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)'
  },

  /* HIDDEN INPUT */
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
    bottom: -1000
  },

  /* MODALS / SHEETS */
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end'
  },
  sheetContainer: {
    backgroundColor: '#161b26',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)'
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginBottom: 16
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  sheetTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4
  },
  sheetSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sheetCloseText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600'
  },
  sheetBody: {
    gap: 20,
    paddingBottom: 20
  },

  modalSection: {
    gap: 8
  },
  sectionHeading: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4
  },

  /* STATUS CARD */
  statusCard: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  statusStateText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600'
  },
  statusHostText: {
    color: '#94a3b8',
    fontSize: 14
  },
  disconnectBtn: {
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)'
  },
  disconnectBtnText: {
    color: '#ff6b6b',
    fontWeight: '600'
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  refreshIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  refreshIconBtnDisabled: {
    opacity: 0.6
  },
  refreshIconText: {
    fontSize: 14
  },
  searchingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  searchingText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500'
  },

  /* DISCOVERED PC LIST */
  emptyCard: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  emptyTitleText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4
  },
  emptyCardText: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center'
  },
  emptyRefreshBtn: {
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(10, 132, 255, 0.3)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 12,
    alignItems: 'center'
  },
  emptyRefreshBtnText: {
    color: '#0a84ff',
    fontSize: 14,
    fontWeight: '600'
  },
  discoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  discoveredIpText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600'
  },
  discoveredMetaText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2
  },
  connectPill: {
    backgroundColor: '#0a84ff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20
  },
  connectPillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600'
  },

  /* MANUAL ENTRY CARD */
  manualCard: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500'
  },
  inputField: {
    backgroundColor: '#161b26',
    color: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  primaryActionBtn: {
    backgroundColor: '#0a84ff',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },

  /* GROUPED SETTINGS */
  groupedContainer: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  groupedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  groupedLabel: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '500'
  },
  groupedValue: {
    color: '#94a3b8',
    fontSize: 14
  },
  groupedDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginLeft: 16
  },
  groupedActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  groupedActionText: {
    color: '#0a84ff',
    fontSize: 15,
    fontWeight: '500'
  },
  groupedChevron: {
    color: '#64748b',
    fontSize: 18
  },

  /* STEPPERS */
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#161b26',
    borderRadius: 10,
    padding: 4
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#222b3d',
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperBtnText: {
    color: '#0a84ff',
    fontSize: 18,
    fontWeight: '600'
  },
  stepperVal: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'center'
  },

  /* DIAGNOSTIC LOGS */
  logContainer: {
    flex: 1,
    backgroundColor: '#090d14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
    marginVertical: 12
  },
  logScrollContent: {
    gap: 8
  },
  logEmptyText: {
    color: '#64748b',
    fontSize: 14
  },
  logRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    paddingBottom: 6
  },
  logTime: {
    color: '#475569',
    fontSize: 11
  },
  logMsg: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2
  },
  logMsgInfo: {
    color: '#cbd5e1'
  },
  logMsgWarn: {
    color: '#ff9500'
  },
  logMsgError: {
    color: '#ff3b30'
  },
  logDetails: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2
  },
  logFooterRow: {
    flexDirection: 'row',
    gap: 12
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  secondaryActionText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600'
  },
  primaryActionBtnSmall: {
    flex: 1,
    backgroundColor: '#0a84ff',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
