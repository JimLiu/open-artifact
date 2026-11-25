# Open Artifact in Pi

This extension connects one Pi conversation to Open Artifact. Requests and comments that the artifact owner sends from the page reach the conversation that created the artifact. Comments from other people appear as notices and do not start a turn

## Try it

Install Pi and the `open-artifact` CLI. Put both commands on `PATH`. Load the [standalone Open Artifact skill](../../README.md#2-as-a-skill-for-any-other-agent) in Pi, then start Pi with this example:

```sh
pi -e ./examples/harness-pi/extension.ts
```

Run `/open-artifact-connect` in Pi. Ask Pi to make a document with the Open Artifact skill. The extension registers `Artifact`, `ArtifactData`, and `ArtifactComments` and uses the Pi session as the caller. Open the artifact link and send a request from **Ask** or a comment thread

Pi shows the response in its own chat. To answer a comment on the page, Pi can reply in its thread. This example does not send replies to the Ask pane. When Pi is closed, Open Artifact queues requests. Resume the same Pi conversation and run `/open-artifact-connect` again to receive them

## Check it

```sh
node --test examples/harness-pi/harness-pi.test.mjs
```

The test uses an isolated Open Artifact home and drives a real Pi process through RPC. It sends an Ask request through the daemon and checks the input that reaches Pi. It does not call a model or open a browser
