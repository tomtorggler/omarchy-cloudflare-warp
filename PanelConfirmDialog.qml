import QtQuick
import qs.Commons
import qs.Ui

// Compact confirmation surface for a narrow bar panel. Omarchy's generic
// ConfirmDialog intentionally uses title-sized message text; this variant
// keeps the hierarchy aligned with PanelHero and ordinary panel rows.
Item {
  id: root

  property bool opened: false
  property string title: ""
  property string message: ""
  property string cancelText: "Cancel"
  property string confirmText: "Confirm"
  property int selectedIndex: 1
  property color background: Color.popups.background
  property color foreground: Color.popups.text
  property color scrim: Util.alpha(Color.popups.background, 0.78)
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property int cornerRadius: Style.cornerRadius

  signal canceled()
  signal confirmed()

  function handleKey(event) {
    if (!opened) return false
    var keyText = String(event.text || "").toLowerCase()
    if (event.key === Qt.Key_Escape) {
      canceled()
      return true
    }
    if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
      selectedIndex = selectedIndex === 0 ? 1 : 0
      return true
    }
    if (event.key === Qt.Key_Left || event.key === Qt.Key_Up
        || keyText === "h" || keyText === "k") {
      selectedIndex = 0
      return true
    }
    if (event.key === Qt.Key_Right || event.key === Qt.Key_Down
        || keyText === "l" || keyText === "j") {
      selectedIndex = 1
      return true
    }
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
      if (selectedIndex === 0) canceled()
      else confirmed()
      return true
    }
    return false
  }

  visible: opened

  Rectangle {
    anchors.fill: parent
    color: root.scrim

    MouseArea { anchors.fill: parent; onClicked: root.canceled() }

    BorderSurface {
      id: card
      width: Math.min(parent.width - Style.space(28), Style.space(330))
      height: contentTopInset + contentBottomInset + dialogContent.implicitHeight
      anchors.centerIn: parent
      color: root.background
      borderSpec: Border.flat(root.accent, Style.normalBorderWidth)
      padding: Style.space(16)
      radius: root.cornerRadius

      MouseArea { anchors.fill: parent; onClicked: {} }

      Column {
        id: dialogContent
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: card.contentLeftInset
        anchors.rightMargin: card.contentRightInset
        anchors.topMargin: card.contentTopInset
        spacing: Style.spacing.labelGap

        Text {
          width: parent.width
          text: root.title
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          font.bold: true
          wrapMode: Text.WordWrap
        }

        Text {
          width: parent.width
          text: root.message
          color: Qt.darker(root.foreground, 1.35)
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        Item {
          width: parent.width
          height: actions.implicitHeight + Style.space(14)

          Row {
            id: actions
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            spacing: Style.spacing.md

            Button {
              width: Style.space(84)
              text: root.cancelText
              bordered: true
              hasCursor: root.selectedIndex === 0
              foreground: root.foreground
              accent: root.accent
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onHovered: function(hovered) { if (hovered) root.selectedIndex = 0 }
              onClicked: root.canceled()
            }

            Button {
              width: Style.space(84)
              text: root.confirmText
              bordered: true
              hasCursor: root.selectedIndex === 1
              foreground: root.foreground
              accent: root.accent
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onHovered: function(hovered) { if (hovered) root.selectedIndex = 1 }
              onClicked: root.confirmed()
            }
          }
        }
      }
    }
  }
}
