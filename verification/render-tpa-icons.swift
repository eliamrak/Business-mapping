import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else { fatalError("Expected original PNG and output directory") }
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width == image.height else { fatalError("Expected the selected square artwork") }

func render(_ size: Int, scale: CGFloat = 1, rounded: Bool = false, opaque: Bool = true) -> CGImage {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: 0, space: space,
                            bitmapInfo: (opaque ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast).rawValue)!
    if opaque {
        context.setFillColor(CGColor(colorSpace: space, components: [3/255, 29/255, 52/255, 1])!)
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    }
    let side = CGFloat(size) * scale
    let inset = (CGFloat(size) - side) / 2
    let target = CGRect(x: inset, y: inset, width: side, height: side)
    context.saveGState()
    if rounded {
        context.addPath(CGPath(roundedRect: target, cornerWidth: side * 0.23, cornerHeight: side * 0.23, transform: nil))
        context.clip()
    }
    context.interpolationQuality = .high
    context.draw(image, in: target)
    context.restoreGState()
    return context.makeImage()!
}

func png(_ image: CGImage, _ name: String) throws {
    let url = output.appendingPathComponent(name)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("PNG output unavailable") }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("PNG output failed") }
}

for size in [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024] {
    try png(render(size), "web-\(size).png")
}
try png(render(512, scale: 0.90), "maskable-512.png")
try png(render(1024, scale: 0.68, rounded: true, opaque: false), "android-adaptive-foreground.png")
for (name, size) in [("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
                     ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
                     ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
                     ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
                     ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)] {
    try png(render(size, scale: size <= 32 ? 0.92 : 0.82, rounded: true, opaque: false), "HorizonLens.iconset/\(name)")
}
print("Derived web, maskable, adaptive and native icon sizes from the unchanged selected raster.")
