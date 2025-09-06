let recorder, chunks = [];
let isRecording = false;

function startRecording() {
  let stream = document.querySelector("canvas").captureStream(60);
  recorder = new MediaRecorder(stream, {
    mimeType: "video/webm; codecs=vp9",
  });
  chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    let blob = new Blob(chunks, { type: "video/webm" });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "flowfield.webm";
    a.click();
  };
  recorder.start();
  isRecording = true;
  console.log("Recording started");
}

function stopRecording() {
  recoder.stop();  // typo: recoder instead of recorder
  isRecording = false;
  console.log("Recording stopped");
}