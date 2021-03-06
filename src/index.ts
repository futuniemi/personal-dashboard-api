import * as http from "http";
import * as WS from "ws";
import * as express from "express";
import * as multer from "multer";
import { PNG } from "pngjs";
import * as cors from "cors";
import { indexFace, recognize } from "./services/aws";
import { transform } from "./services/faceapp";
import { detect } from "./services/opencv";
import { config } from "./config";
import { getMissingHours } from "./services/missing-hours";

const app = express();
app.use(cors());
const bodyParser = multer();

app.post("/faces", bodyParser.single("file"), async (req, res) => {
  if (!req.body.id) {
    return res.status(400).send('Missing "id" field');
  }

  try {
    await indexFace(req.body.id, req.file);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }

  res.status(201).send();
});

app.post("/recognize", bodyParser.single("file"), async (req, res) => {
  try {
    const result = await recognize(req.file);
    res.status(200).send(result);
  } catch (err) {
    if (err.message.indexOf("There are no faces in the image.")) {
      return res.status(400).send(err.message);
    }
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.post("/transform", bodyParser.single("file"), async (req, res) => {
  try {
    const buffer = await transform(req.query.filter || "old", req.file);
    res.status(200).send(buffer.toString("base64"));
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.get("/missing-hours/:userId", async (req, res) => {
  try {
    const missing = await getMissingHours(req.params.userId);
    if (missing === null) {
      res.status(404).end();
      return;
    }

    res.status(200).send({ missing });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/*
 * Websockets
 */

const server = http.createServer(app);
const wss = new WS.Server({ server });

wss.on("connection", function connection(ws) {
  ws.on("error", () => {});
  ws.on("message", function incoming(message: Buffer) {
    const png = new PNG({
      width: (message[0] << 8) | (message[1] & 0xff),
      height: (message[2] << 8) | (message[3] & 0xff)
    });

    png.data = message.slice(4);

    const buffers: Buffer[] = [];
    const stream = png.pack();

    stream.on("data", (chunk: Buffer) => buffers.push(chunk));
    stream.on("error", err => console.error(err));
    stream.on("end", async () => {
      try {
        const buffer = Buffer.concat(buffers);
        const objects = await detect(buffer);

        if (ws.readyState !== ws.CLOSED) {
          ws.send(JSON.stringify({ objects }));
        }
      } catch (err) {
        console.log(err);
      }
    });
  });
});

server.listen(config.PORT || 3000, () =>
  console.log("Listening on %d", server.address().port)
);
