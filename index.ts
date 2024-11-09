import mqtt from "mqtt";
import { Database } from "bun:sqlite";

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const client = mqtt.connect("mqtt://192.168.31.3");

const db = new Database("plantica.sqlite", { create: true });

// enable for performance
db.exec("PRAGMA journal_mode = WAL;");
// db.exec(`CREATE TABLE plant1(
//     ts DATETIME PRIMARY KEY DEFAULT CURRENT_TIMESTAMP,
//     humidity INTEGER
// );`);

const getWateringLevel = (humidity: number) => {
  const over = 90;
  const optimal = 60;
  const under = 30;
  switch (true) {
    case humidity > over:
      return "OVER";
    case humidity >= optimal && humidity <= over:
      return "OPTIMAL";
    case humidity >= under && humidity < optimal:
      return "UNDER";
    default:
      return "NO";
  }
};

client.on("connect", () => {
  console.log("connected to MQTT");
  client.subscribe("plantica/plant1", (err) => {
    if (err) {
      console.log(err);
    }
  });
});

initializeApp({ credential: applicationDefault() });

const deviceToken =
  "eJ2F-_igRiOrbQ2PjB17G5:APA91bH5TWriYwWE2h2IXeOqo7Dzzaoiy1FhcR7Itnjz1DC-h1xo5QWxPanHrVjt7AHO9vsufCif3ayijonzlLyPZl8FYoRk509oNrUw4OslyhanTArU02Y";

const sendMsg = (title: string, body: string, channelId: string) => {
  return getMessaging().send({
    token: deviceToken,
    notification: {
      title,
      body,
    },
    android: {
      notification: {
        channelId,
      },
    },
  });
};

let prvWaterLevel: ReturnType<typeof getWateringLevel>;

client.on("message", async (topic, message) => {
  // message is Buffer, convert to number
  const humidity = +message.toString();
  const query = db.prepare("INSERT INTO plant1 (humidity) VALUES ($param)");
  query.run(humidity);

  const level = getWateringLevel(humidity);
  console.log(humidity, level);
  if (
    prvWaterLevel === level ||
    // ignoer if level goes from over to optimal
    (prvWaterLevel === "OVER" && level === "OPTIMAL")
  )
    return;
  prvWaterLevel = level;

  switch (level) {
    case "OPTIMAL":
      await sendMsg(
        "Wow, you watered me!",
        "Are you actually watering me today?\nNah, maybe it's just raining.",
        "optimal-watering",
      );
      break;
    case "NO":
      await sendMsg(
        "I'll take a dog piss.",
        "It's more likely for a dog to pee on me, than YOU ever watering me.",
        "no-watering",
      );
      break;

    case "UNDER":
      await sendMsg(
        "A little more, please?",
        "Please water me more today. If I was human, I could have walked and taken it myself.\nBut I can't.",
        "under-watering",
      );
      break;

    case "OVER":
      await sendMsg(
        "Stop right there!",
        "Stop, stop, stop. It's a lot of water for me to drink in a day.",
        "over-watering",
      );
      break;
    default:
      break;
  }
});

// Setup simple HTTP server in bun
const server = Bun.serve({
  port: 3000,
  hostname: "0.0.0.0",
  fetch(request) {
    const query = db
      .query("SELECT ts, humidity from plant1 ORDER BY ts DESC LIMIT 100")
      .all() as [{ ts: string; humidity: number }];

    const values = query.map((row) => ({ value: row.humidity, date: row.ts }));
    const res = new Response(JSON.stringify(values.reverse()), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
    return res;
  },
});

console.log(`Listening on ${server.url}`);

