require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion } = require("mongodb");

// Adds headers: Access-Control-Allow-Origin: *
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("hire-loop-server is running");
});

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
  const db = client.db("hire_loop_db");
  const jobsCollection = db.collection("jobs");

  app.post("/jobs", async (req, res) => {
    const job = req.body;
    const result = await jobsCollection.insertOne(job);
    res.send(result);
  });

  
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
