import QtQuick
import QtQuick.Shapes
import qs.Commons

Item {
  id: root
  property real iconSize: Style.font.icon
  property color color: Color.foreground
  property color indicatorColor: Color.foreground
  property color dimColor: Util.alpha(indicatorColor, 0.55)
  property color badgeColor: Color.urgent
  property color backgroundColor: Color.popups.background
  property string fontFamily: Style.font.family
  // connected | disconnected | connecting | urgent. Unknown values fail
  // visually closed instead of looking like a healthy connection.
  property string status: "disconnected"
  // Activity is orthogonal to status: recovery can pulse while retaining its
  // urgent badge, and a settings mutation can pulse while still connected.
  property bool pulse: false
  readonly property string visualStatus: ["connected", "disconnected", "connecting", "urgent"].indexOf(status) !== -1
    ? status : "urgent"
  readonly property real statusSize: Math.max(7, root.iconSize * 0.44)

  width: iconSize * 1.22
  height: iconSize
  implicitWidth: width
  implicitHeight: height

  // A code-native cloud silhouette: no icon-font or proprietary asset needed.
  Shape {
    id: cloudMark
    anchors.fill: parent
    antialiasing: true
    layer.enabled: true
    layer.samples: 4

    ShapePath {
      fillColor: root.color
      strokeWidth: 0
      startX: root.width * 0.20
      startY: root.height * 0.80
      PathCubic { x: root.width * 0.03; y: root.height * 0.72; control1X: root.width * 0.08; control1Y: root.height * 0.80; control2X: root.width * 0.03; control2Y: root.height * 0.76 }
      PathCubic { x: root.width * 0.25; y: root.height * 0.38; control1X: root.width * 0.01; control1Y: root.height * 0.54; control2X: root.width * 0.10; control2Y: root.height * 0.40 }
      PathCubic { x: root.width * 0.62; y: root.height * 0.15; control1X: root.width * 0.33; control1Y: root.height * 0.18; control2X: root.width * 0.49; control2Y: root.height * 0.11 }
      PathCubic { x: root.width * 0.89; y: root.height * 0.44; control1X: root.width * 0.77; control1Y: root.height * 0.17; control2X: root.width * 0.87; control2Y: root.height * 0.29 }
      PathCubic { x: root.width * 0.79; y: root.height * 0.80; control1X: root.width * 1.04; control1Y: root.height * 0.48; control2X: root.width * 1.01; control2Y: root.height * 0.76 }
      PathLine { x: root.width * 0.20; y: root.height * 0.80 }
    }

    SequentialAnimation on opacity {
      running: root.pulse
      loops: Animation.Infinite
      alwaysRunToEnd: true
      NumberAnimation { from: 1.0; to: 0.5; duration: 650; easing.type: Easing.InOutSine }
      NumberAnimation { from: 0.5; to: 1.0; duration: 650; easing.type: Easing.InOutSine }
    }
  }

  Rectangle {
    id: statusBadge
    width: root.statusSize
    height: width
    radius: width / 2
    color: {
      if (root.visualStatus === "connected") return root.indicatorColor
      if (root.visualStatus === "urgent") return root.badgeColor
      return root.backgroundColor
    }
    border.width: Math.max(1, Math.round(width * 0.11))
    border.color: {
      if (root.visualStatus === "disconnected") return root.dimColor
      if (root.visualStatus === "connecting") return root.indicatorColor
      return root.backgroundColor
    }
    anchors.right: parent.right
    anchors.bottom: parent.bottom

    Behavior on color { ColorAnimation { duration: 120 } }

    Text {
      visible: root.visualStatus === "connected" || root.visualStatus === "urgent"
      anchors.centerIn: parent
      text: root.visualStatus === "connected" ? "✓" : "!"
      color: root.backgroundColor
      font.family: root.fontFamily
      font.pixelSize: Math.max(6, parent.height * 0.76)
      font.bold: true
    }

    Rectangle {
      visible: root.visualStatus === "disconnected"
      width: parent.width * 0.48
      height: Math.max(1, Math.round(parent.height * 0.14))
      radius: height / 2
      color: root.dimColor
      anchors.centerIn: parent
    }

    Rectangle {
      visible: root.visualStatus === "connecting"
      width: Math.max(2, parent.width * 0.28)
      height: width
      radius: width / 2
      color: root.indicatorColor
      anchors.centerIn: parent
    }
  }
}
