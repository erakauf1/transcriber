// Renders the iOS app icon: run `swift scripts/make-ios-icon.swift` from the repo root.
import AppKit

let size = 1024
let out = URL(fileURLWithPath: "ios/Transcriber/Assets.xcassets/AppIcon.appiconset/icon-1024.png")

// The App Store rejects icons with an alpha channel, so render into an opaque RGB context.
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!

let top = CGColor(srgbRed: 0x63 / 255, green: 0x5b / 255, blue: 0xff / 255, alpha: 1)
let bottom = CGColor(srgbRed: 0x43 / 255, green: 0x38 / 255, blue: 0xca / 255, alpha: 1)
let gradient = CGGradient(colorsSpace: space, colors: [top, bottom] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: size), end: CGPoint(x: size, y: 0), options: [])

let config = NSImage.SymbolConfiguration(pointSize: 520, weight: .medium)
    .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
let symbol = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
var rect = CGRect(origin: .zero, size: symbol.size)
let cg = symbol.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let scale = 560 / CGFloat(cg.height)
let drawn = CGSize(width: CGFloat(cg.width) * scale, height: CGFloat(cg.height) * scale)
ctx.draw(cg, in: CGRect(x: (CGFloat(size) - drawn.width) / 2, y: (CGFloat(size) - drawn.height) / 2,
                        width: drawn.width, height: drawn.height))

let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: out)
print("wrote \(out.path)")
