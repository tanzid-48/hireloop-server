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
    const companiesCollection = db.collection("companies");

    // define API endpoints for jobs
    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const result = await jobsCollection.insertOne(job);
      res.send(result);
    });

    // GET /api/company?recruiterId=123
    app.get("/api/company", async (req, res) => {
      const { recruiterId } = req.query;
      if (!recruiterId)
        return res.status(400).send({ message: "recruiterId required" });
      const company = await companiesCollection.findOne({ recruiterId });
      res.send(company || null);
    });

    // GET /api/companies/:id

    app.get("/api/companies/:id", async (req, res) => {
      const { ObjectId } = require("mongodb");
      try {
        const company = await companiesCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!company) return res.status(404).json({ message: "Not found" });
        res.json(company);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // PATCH /api/companies/:id
    app.patch("/api/companies/:id", async (req, res) => {
      const { ObjectId } = require("mongodb");
      try {
        const result = await companiesCollection.findOneAndUpdate(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body },
          { returnDocument: "after" },
        );
        res.json(result);
      } catch {
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /jobs?companyId=123&status=active

    app.get("/jobs", async (req, res) => {
      const query = {};
      if (req.query.companyId) {
        query.companyId = req.query.companyId;
      }
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = jobsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Company related API endpoints

    app.post("/api/companies", async (req, res) => {
      const company = req.body;
      const result = await companiesCollection.insertOne(company);
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
