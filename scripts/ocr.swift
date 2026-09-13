// Local OCR; image pixels never leave this machine. Build with npm run build:ocr.
import Foundation
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
    do {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        let handler = VNImageRequestHandler(url: URL(fileURLWithPath:path))
        try handler.perform([request])
        let rows: [[String:Any]] = (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return ["text":candidate.string,"confidence":candidate.confidence,
                    "x":box.minX,"y":1-box.maxY,"width":box.width,"height":box.height]
        }
        let data = try JSONSerialization.data(withJSONObject:["path":path,"text":rows], options:[.sortedKeys])
        print(String(data:data,encoding:.utf8)!)
    } catch {
        fputs("OCR failed: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}
