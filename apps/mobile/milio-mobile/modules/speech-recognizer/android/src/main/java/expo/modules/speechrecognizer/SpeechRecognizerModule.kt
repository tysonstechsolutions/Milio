package expo.modules.speechrecognizer

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpeechRecognizerModule : Module() {

  private var recognizer: SpeechRecognizer? = null
  private var isListening = false
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("SpeechRecognizer")

    Events("onPartialResult", "onResult", "onEnd", "onError", "onStart")

    Function("isAvailable") {
      val context = appContext.reactContext ?: return@Function false
      SpeechRecognizer.isRecognitionAvailable(context)
    }

    Function("start") {
      val context = appContext.reactContext ?: return@Function null

      mainHandler.post {
        if (isListening) {
          recognizer?.stopListening()
        }

        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context)

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        recognizer?.setRecognitionListener(object : RecognitionListener {
          override fun onReadyForSpeech(params: Bundle?) {
            isListening = true
            sendEvent("onStart", mapOf("ready" to true))
          }

          override fun onBeginningOfSpeech() {
            // User started speaking
          }

          override fun onRmsChanged(rmsdB: Float) {
            // Audio level changed - could use for visual feedback
          }

          override fun onBufferReceived(buffer: ByteArray?) {}

          override fun onEndOfSpeech() {
            isListening = false
            sendEvent("onEnd", mapOf("reason" to "endOfSpeech"))
          }

          override fun onError(error: Int) {
            isListening = false
            val errorMessage = when (error) {
              SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
              SpeechRecognizer.ERROR_CLIENT -> "Client side error"
              SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
              SpeechRecognizer.ERROR_NETWORK -> "Network error"
              SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
              SpeechRecognizer.ERROR_NO_MATCH -> "No speech match"
              SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
              SpeechRecognizer.ERROR_SERVER -> "Server error"
              SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input"
              else -> "Unknown error: $error"
            }
            sendEvent("onError", mapOf("error" to error, "message" to errorMessage))
          }

          override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val text = matches?.firstOrNull() ?: ""
            sendEvent("onResult", mapOf("text" to text, "isFinal" to true))
          }

          override fun onPartialResults(partialResults: Bundle?) {
            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val text = matches?.firstOrNull() ?: ""
            if (text.isNotEmpty()) {
              sendEvent("onPartialResult", mapOf("text" to text, "isFinal" to false))
            }
          }

          override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        recognizer?.startListening(intent)
      }
      null
    }

    Function("stop") {
      mainHandler.post {
        isListening = false
        recognizer?.stopListening()
      }
      null
    }

    Function("destroy") {
      mainHandler.post {
        isListening = false
        recognizer?.destroy()
        recognizer = null
      }
      null
    }

    OnDestroy {
      mainHandler.post {
        recognizer?.destroy()
        recognizer = null
      }
    }
  }
}
