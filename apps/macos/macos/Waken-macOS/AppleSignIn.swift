import AppKit
import AuthenticationServices

/// Sign in with Apple on the Mac: Apple's own sheet, over Waken's window. Gives back Apple's identity token and
/// one-time code for the Waken accounts, or nothing when the user closes the sheet.
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  static let shared = AppleSignIn()

  private var completion: ((Result<[String: String]?, Error>) -> Void)?
  private var controller: ASAuthorizationController?

  func start(_ completion: @escaping (Result<[String: String]?, Error>) -> Void) {
    DispatchQueue.main.async { [self] in
      // One sheet at a time: a second press answers the first caller with "closed".
      self.completion?(.success(nil))
      self.completion = completion
      let request = ASAuthorizationAppleIDProvider().createRequest()
      request.requestedScopes = [.fullName, .email]
      let controller = ASAuthorizationController(authorizationRequests: [request])
      controller.delegate = self
      controller.presentationContextProvider = self
      self.controller = controller
      controller.performRequests()
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    NSApp.keyWindow ?? NSApp.windows.first ?? NSWindow()
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) })
    else {
      return finish(.failure(NSError(domain: "Waken", code: 3, userInfo: [NSLocalizedDescriptionKey: "Apple n'a pas renvoyé d'identité."])))
    }
    var result = ["identityToken": token]
    if let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) { result["authorizationCode"] = code }
    finish(.success(result))
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    if (error as? ASAuthorizationError)?.code == .canceled { return finish(.success(nil)) }
    finish(.failure(error))
  }

  private func finish(_ result: Result<[String: String]?, Error>) {
    let done = completion
    completion = nil
    controller = nil
    done?(result)
  }
}
