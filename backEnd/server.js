const express = require('express')
const app = express()
const mysql = require('mysql2');
const multer = require('multer');
const cors = require('cors');
const AdmZip = require('adm-zip');
//const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config(); // Gets environment variables working
// Used for uploading a file, though its not stored locally with this config
const upload = multer();

// Enable CORS so no complaints with FE & BE communication
app.use(cors());
// express.json() middleware is used to parse incoming requests with JSON payloads
app.use(express.json());

// Create a sql connection pool, using mysql 2 its already promise based
const pool = mysql.createPool({
	host: process.env.SQL_HOST, // 'localhost' for us but 'traffic_visual-mysqlserver' for docker,
	port: process.env.DATABASE_PORT,
	user: 'root',
	password: 'P@ssw0rd1234!',
	database: 'traffic_visual',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
	multipleStatements: true
});

const promisePool = pool.promise() // Makes the query commands return a promise

/*
 * Takes a request object and tries to get a valid username from it
 * @param req (app.get/post req) The request to read from
 * @return The username found
 * @throws If there is no "token" or the "token" is invalid, and object is thrown ({status, message})
 */
function verifyToken(req) {
	const token = req.headers['authorization'];
	if (!token) {
		throw { status: 403, message: 'No token provided!' };
	}
	const actualToken = token.split(' ')[1];

	try {
		let decoded = jwt.verify(actualToken, process.env.SECRET_KEY);
		if (!decoded) {
			throw { status: 401, message: 'Failed to authenticate token.' };
		}

		return decoded;
	} catch (err) {
		throw { status: 401, message: "Login Token has expired" };
	}
}

// Verifies User token
app.get('/api/verify-token', async (req, res) => {
	try {
		let username = verifyToken(req).username;
		res.status(200).json({ message: 'Token is valid', username: username });
	} catch (exception) {
		console.log(exception);
		res.status(exception.status).send(exception.message);
	}
});



// Gets Collection Names associated with the token
app.get('/api/get-collections', async (req, res) => {
	try {
		//var username = verifyToken(req);
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		return res.status(exception.status).send(exception.message);
	}

	try {

		const [sims] = await promisePool.query("SELECT sim_name FROM simulations WHERE sim_owner = ?", [user_id]);

		// reduce from simulation info to just simulation name
		const simNames = sims.map((sim) => sim.sim_name);
		return res.json(simNames);

	} catch (err) {
		console.error("Error getting collections:", err);
		return res.status(500).json({ message: 'Internal server error' });
	}
});


/*
 * Gets the directory for the logged in user, returning an array
 * of objects with values: "sim_name", "sim_date", "sim_id"
 */
app.get("/api/get-directory", async (req, res) => {
	try {
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		return res.status(exception.status).send(exception.message);
	}

	try {

		const [sims] = await promisePool.query("SELECT sim_name, sim_date, sim_id FROM simulations WHERE sim_owner = ?", [user_id]);

		return res.json(simNames);

	} catch (err) {
		console.error("Error getting collections:", err);
		return res.status(500).json({ message: 'Internal server error' });
	}
});

// Selects file names from a given collection_name and username from verified token
app.get('/api/select-uploads', async (req, res) => {

	// get the username
	try {
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		return res.status(exception.status).send(exception.message);
	}

	// query database and stuff
	try {
		const sim_name = req.query.collection_name;

		if (!sim_name)
			return res.status(400).send("Missing simulation name");

		// bad, but this entire thing is bad
		const [[{ sim_id }]] = await promisePool.query("SELECT sim_id FROM simulations WHERE sim_owner = ? AND sim_name = ?", [user_id, sim_name]);
		const [files] = await promisePool.query("SELECT file_type FROM text_files WHERE file_sim = ?", [sim_id, sim_id]);

		// convert returned object to strings
		const fileNames = files.map((file) => (FileTypeToName(file.file_type)));
		res.json(fileNames);

	} catch (err) {
		console.error(err);
		res.status(500).send('Server Error');
	}
});

// Delete Collection query
app.post('/api/delete-collection', async (req, res) => {

	// get the username
	try {
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		if (!exception.status)
			exception.status = 500;
		return res.status(exception.status).send(exception.message);
	}

	try {
		const { collection_name } = req.query;

		// bad, but this entire thing is bad
		const [[{ sim_id }]] = await promisePool.query("SELECT sim_id FROM simulations WHERE sim_owner = ? AND sim_name = ?", [user_id, collection_name]);

		const deleteFileQuery = "DELETE FROM text_files WHERE file_sim = ?; DELETE FROM simulations WHERE sim_id = ?;";
		await promisePool.query(deleteFileQuery, [sim_id, sim_id, sim_id]);
		res.send("File deletion successful");
	} catch (err) {
		console.error('Error deleting data:', err);
		res.status(500).send('Error deleting data.');
	}
});

// Delete file query - Removed
app.post('/api/delete-upload', async (req, res) => {

	// get the username
	try {
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		return res.status(exception.status).send(exception.message);
	}

	try {
		// delete file
		await promisePool.query("DELETE FROM text_files where file_name = ? AND file_owner = ?", [req.body.fileName, user_id])

		res.send("File deletion successful");
	} catch (err) {
		console.error('Error deleting data:', err);
		res.status(500).send('Error deleting data.');
	}
});

// Upload file Query
app.post('/api/upload', upload.single('file'), async (req, res) => {

	// make sure a file was actually uploaded
	if (!req.file)
		return res.status(400).send('No file uploaded.');

	// Check if the uploaded file is a zip file
	const file = req.file;
	if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed')
		return res.status(400).send('Please upload a valid zip file.');

	// make sure its only simple strings
	if (!IsValidUserInfo(req.body.collectionName))
		return res.status(403).send("Invalid username or password");

	// get the username
	try {
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		return res.status(exception.status).send(exception.message);
	}

	// try and create the simulation document
	try {

		const name = req.body.collectionName;
		const date = (new Date()).toLocaleString();
		// Check if its been uploaded
		const result = await promisePool.query("SELECT sim_id FROM simulations WHERE sim_name = ?", [name]);
		if (result[0] && result[0].length > 0 && result[0][0].sim_id) {
			console.log('Collection ' + name + ' already exists');
			return res.status(400).send('Collection ' + name + ' already exists');
		}

		const simInsert = "INSERT INTO simulations (sim_name, sim_date, sim_owner) VALUES (?, ?, ?); SELECT LAST_INSERT_ID();";
		var [[_, [sim_id]]] = await promisePool.query(simInsert, [name, date, user_id]);
		//console.log(user_id);
		sim_id = sim_id["LAST_INSERT_ID()"];

		//console.log("Simulation: " + sim_id);

		//res.send('File data inserted successfully.');
	} catch (error) {
		console.error('Error inserting data:', error);
		return res.status(500).send('Error inserting data.');
	}


	// try and read the actual zip file
	try {
		const zip = new AdmZip(file.buffer);
		const zipEntries = zip.getEntries();

		for (const entry of zipEntries) {
			if (!entry.isDirectory) {
				try {
					const fileContent = entry.getData().toString('ascii');
					await ReadFile(user_id, sim_id, fileContent, entry.name);
				} catch (e) { console.error("ERRORRR", e);/* not a text file? (ignore it)*/ }
			}
		}
	} catch (err) {
		console.error("Error reading zip file: ", err);
		return res.status(500).send("Error reading data.");
	}

	res.send('File data inserted successfully.');
});


/*
 * Gets a specific file for a specific simulation based
 * on the variables in the request and the constant file type
 * The query value "sim" is specified to be the simulation
 *   id of the simulation being accessed
 */
async function tryGetFile(req, res, fileType) {

	// get the username
	try {
		var user_id = verifyToken(req).user_id;
	} catch (exception) {
		var user_id = 1;
		// TBD uncomment when ready for real use
		return res.status(exception.status).send(exception.message);
	}


	try {

		// get the simulation id from query or by name
		let sim_id;
		try {
			sim_id = parseInt(req.query.sim); // to throw exception
			if (isNaN(sim_id))
				throw "";
		} catch (e) {
			[[sim_id]] = await promisePool.query("SELECT sim_id FROM simulations WHERE sim_name = ? AND sim_owner = ?", [req.query.sim, user_id]);
			if (sim_id)
				sim_id = sim_id.sim_id;
		}

		if (!sim_id)
			return res.status(500).send("Simulation not found");

		// get the actul
		const query = "SELECT file_owner, file_content FROM text_files WHERE file_type = ? AND file_sim = ?";
		const [[entry]] = await promisePool.query(query, [fileType, sim_id]);

		// make sure the simulation exists
		if (!entry)
			return res.status(500).send("File not found");

		// check whether or not they are allowed
		if (entry.file_owner != user_id) // make this throw/return an error when done
			console.log("tryGetFile: Wrong owner! (" + user_id + " != " + entry.file_owner + ")");

		// ???
		let buf = Buffer.from(entry.file_content);
		let obj = ReadFile_Any(buf, fileType, req.query);
		return res.json(obj);
	} catch (err) {
		console.error(err);
		return res.status(500).send("Server Error: Couldn't retrieve directory");
	}
}

/*
 * Gets the summary file
 */
app.get('/api/file-summary', async (req, res) => await tryGetFile(req, res, FILE_SUMMARY));

/*
 * Gets the Overview file
 */

app.get('/api/file-overview', async (req, res) => await tryGetFile(req, res, FILE_OVERVIEW));

/*
 * Gets the node file (input file 1)
 */
app.get("/api/file-nodes", async (req, res) => await tryGetFile(req, res, FILE_NODES));

/*
 * Gets the edge file (input file 2)
 */
app.get('/api/file-edges', async (req, res) => await tryGetFile(req, res, FILE_EDGES));

/*
 * Gets the signals file (input file 3)
 */
app.get('/api/file-signals', async (req, res) => await tryGetFile(req, res, FILE_SIGNALS));

/*
 * Gets the average conditions file (output file 11)
 */
app.get('/api/file-avgconds', async (req, res) => await tryGetFile(req, res, FILE_AVGCONDS));

/*
 * Gets the time based conditions file (output file 12)
 */
app.get('/api/file-conds', async (req, res) => await tryGetFile(req, res, FILE_CONDS));


/*
 * Gets the shortest paths file (output file 13)
 */
app.get('/api/file-paths', async (req, res) => await tryGetFile(req, res, FILE_PATHS));

/*
 * Gets the trip probes file (output file 15)
 */
app.get('/api/file-tripprobes', async (req, res) => await tryGetFile(req, res, FILE_TRIPPROBES));

/*
 * Gets the edge probes file (output file 16)
 */
app.get('/api/file-edgeprobes', async (req, res) => await tryGetFile(req, res, FILE_EDGEPROBES));




function IsValidUserInfo(str) {
	if (!str || !("" + str === str))
		return 0;
	const len = str.length;
	const n0 = "0".charCodeAt(0);
	const n1 = "9".charCodeAt(0);
	const a0 = "a".charCodeAt(0);
	const a1 = "z".charCodeAt(0);
	const A0 = "A".charCodeAt(0);
	const A1 = "Z".charCodeAt(0);
	const sp = " ".charCodeAt(0);
	for (let i = 0; i < len; i++) {
		const c = str.charCodeAt(i);
		if (!(c == sp || (c >= n0 && c <= n1) || (c >= a0 && c <= a1) || (c >= A0 && c <= A1)))
			return 0;
	}
	return 1;
}

// Route to login and generate a JWT
app.post('/login', async (req, res) => {
	const { username, password } = req.body;
	console.log('Login Requested with:', username, password);

	// make sure its only simple strings
	if (!IsValidUserInfo(username) || !IsValidUserInfo(password))
		return res.status(403).send("Invalid username or password");

	try {
		const [[user]] = await promisePool.query("SELECT user_id FROM users WHERE username = ? AND password = ?", [username, password]);

		// username pair does not exist
		if (!user) {
			console.log('Invalid username or password');
			return res.status(401).json({ message: 'Invalid credentials' });
		}

		// Sign the token with the secret key
		const userInfo = { username: username, user_id: user.user_id }; // Payload data for the token
		const token = jwt.sign(userInfo, process.env.SECRET_KEY, { expiresIn: '1h' });

		return res.json({ token: token });

	} catch (err) {
		console.error('Error checking user login:', err);
		return res.status(401).json({ message: 'Query Failed' });
	}
});

// Route to register a new user
app.post('/register', async (req, res) => {
	const { username, password } = req.body;

	// make sure its only simple strings
	if (!IsValidUserInfo(username) || !IsValidUserInfo(password))
		return res.status(403).send("Invalid username or password");

	try {
		// Check if the username already exists
		const [[{ existingUser }]] = await promisePool.query("SELECT EXISTS( SELECT * FROM users WHERE username = ?)", [username]);

		if (existingUser) {
			return res.status(409).json({ message: 'Username already exists' });
		}

		// Insert new user
		await promisePool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
		return res.status(201).json({ message: 'User created successfully. Please log in.' });
	} catch (error) {
		console.error('Error registering user:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

app.listen(process.env.PORT, () => {
	console.log('Server.js App is listening on port: ' + process.env.PORT);
});

// Closes DB Connections on receiving end signals
const shutdown = async () => {
	try {
		await pool.end();
		console.log('Connection pool closed.');
		process.exit(0);
	} catch (err) {
		console.error('Error closing connection pool:', err);
		process.exit(1);
	}
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);




// file read and write functions //

const FILE_OVERVIEW = 0;	// file 10
const FILE_AVGCONDS = 1;	// file 11
const FILE_CONDS = 2;		// file 12
const FILE_PATHS = 3;		// file 13
const FILE_SUMMARY = 4;		// summary
const FILE_TRIPPROBES = 5;	// file 15
const FILE_EDGEPROBES = 6;	// file 16
const FILE_NODES = 7;		// file 1
const FILE_EDGES = 8;		// file 2
const FILE_SIGNALS = 9;		// file 3


/*
 * Reads floats from a nodejs buffer and puts them into
 *   an object at specific names
 * @param obj (table) Where the resulting values are placed into
 * @param names (string[]) The indexs, in order, that the values should put at in the object/table
 * @param buf (nodejs buffer) The buffer to read from
 * @param off (int) The offset in the buffer to read from
 * @return (int) The resulting offset from all of the reads
 */
function ReadFromBufFloats(obj, names, buf, off) {
	for (let i = 0; i < names.length; i++) {
		obj[names[i]] = buf.readFloatLE(off);
		off += 4;
	}
	return off;
}

/*
 * Reads ints from a nodejs buffer and puts them into
 *   an object at specific names
 * @param obj (table) Where the resulting values are placed into
 * @param names (string[]) The indexs, in order, that the values should put at in the object/table
 * @param buf (nodejs buffer) The buffer to read from
 * @param off (int) The offset in the buffer to read from
 * @return (int) The resulting offset from all of the reads
 */
function ReadFromBufInts(obj, names, buf, off) {
	for (let i = 0; i < names.length; i++) {
		obj[names[i]] = buf.readInt32LE(off);
		off += 4;
	}
	return off;
}

/*
 * Reads shorts from a nodejs buffer and puts them into
 *   an object at specific names
 * @param obj (table) Where the resulting values are placed into
 * @param names (string[]) The indexs, in order, that the values should put at in the object/table
 * @param buf (nodejs buffer) The buffer to read from
 * @param off (int) The offset in the buffer to read from
 * @return (int) The resulting offset from all of the reads
 */
function ReadFromBufShorts(obj, names, buf, off) {
	for (let i = 0; i < names.length; i++) {
		obj[names[i]] = buf.readInt16LE(off);
		off += 2;
	}
	return off;
}

/*
 * Same as the others with the same name, but this one allows you
 *   to choose the type with a letter at the start of the name of
 *   the table entry. b: byte, s: short, i: int, f: float
 */
function ReadFromBufAny(obj, names, buf, off) {
	for (let i = 0; i < names.length; i++) {
		let size;
		let v;
		const mid = names[i].indexOf("_");
		switch (names[i].charAt(0)) {
			case "b": v = buf.readInt8(off); off += 1; break;
			case "s": v = buf.readInt16LE(off); off += 2; break;
			case "i": v = buf.readInt32LE(off); off += 4; break;
			case "f": v = buf.readFloatLE(off); off += 4; break;
			case "c": case "n": {
				let vsize = (names[i].charAt(0) == "c") ? 2 : 3;
				v = buf.readUIntLE(off, vsize);
				off += vsize;
				v /= Math.pow(10, names[i].charCodeAt(1) - 48);
			} break;
		}
		obj[names[i].substring(mid + 1)] = v;
	}
	return off;
}

/*
 * Reads a string from a nodejs buffer that was written
 *   with WriteString().
 * The string should be stored by a single byte specifying
 *   its length, then the actual string
 * @param buf (nodejs buffer) The buffer to read from
 * @param off (int) The offset to read from
 * @return ([int, string]) The resulting offset and string
 */
function ReadString(buf, off) {
	const len = buf.readInt8(off);
	const tag = buf.toString("ascii", off + 1, off + 1 + len);
	return [off + 1 + len, tag];
}

/*
 * Reads some number of shorts from a buffer and makes an
 *   array of them. A "short" is 2 bytes
 * @param buf (nodejs buffer) The buffer to read from
 * @param len (int) The number of shorts to read
 * @param off (int) The initial offset in "buf" to read from
 * @return ([int, int[]]) The resulting offset and array
 */
function ReadFromBufShortArray(buf, len, off) {
	let arr = new Array(len);
	for (let i = 0; i < len; i++)
		arr[i] = buf.readInt16LE(off + 2 * i);
	return [off + 2 * len, arr];
}

/*
 * Same as ReadFromBufShortArray(), but with floats
 */
function ReadFromBufFloatArray(buf, len, off) {
	let arr = new Array(len);
	for (let i = 0; i < len; i++)
		arr[i] = buf.readFloatLE(off + 4 * i);
	return [off + 4 * len, arr];
}



/*
 * Reads an input as a summary file.
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_summary(buf) {
	const SUMMARY_TAGS = [
		"vehicle trips", "person trips", "vehicle-km", "person-km", "vehicle-stops", "vehicle-secs",
		"person-secs", "total delay", "stopped delay", "accel/decel delay", "accel-noise", "fuel (l)",
		"HC (g)", "CO (g)", "NOx (g)", "CO2 (g)", "PM (g)", "crashes*10e-6",
		"injury crashes", "fatal crashes", "no damage", "minor damage", "moderate damage", "dollars of toll"
	];

	let out = { total: {}, average: {} };
	let off = 0;

	const lenA = buf.readInt16LE(off + 0);
	const lenB = buf.readInt16LE(off + 2);
	off += 4;

	// read the total
	for (let i = 0; i < lenA; i++) {
		let line = [1, 2, 3, 4, 5, 6];
		for (let ii = 0; ii < 6; ii++)
			line[ii] = buf.readFloatLE((off += 4) - 4);
		let tag = "";
		[off, tag] = ReadString(buf, off);
		out.total[tag] = line;
	}

	// read the average
	for (let i = 0; i < lenB; i++) {
		let line = [1, 2, 3, 4, 5, 6];
		for (let ii = 0; ii < 6; ii++)
			line[ii] = buf.readFloatLE((off += 4) - 4);
		let tag = "";
		[off, tag] = ReadString(buf, off);
		out.average[tag] = line;
	}

	return out;
}


/*
 * Reads an input as input file 1 (node file)
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_nodes(buf) {
	let out = {};

	// define and read initial values
	out.count = buf.readInt16LE(0);
	out.xScale = buf.readFloatLE(2);
	out.yScale = buf.readFloatLE(6);
	out.nodes = [];

	// read each node
	let off = 10;
	for (let i = 0; i < out.count; i++) {
		let node = {};
		node.id = buf.readInt16LE(off + 0);
		node.x = buf.readFloatLE(off + 2);
		node.y = buf.readFloatLE(off + 6);
		node.type = buf.readInt8(off + 10);
		node.zone = buf.readInt16LE(off + 11);
		const info = buf.readFloatLE(off + 13);
		if (info != 0) node.info
		const tagLen = buf.readInt8(off + 17);
		if (tagLen > 0) {
			node.tag = buf.toString("ascii", off + 18, off + 18 + tagLen);
		}
		off += 18 + tagLen;
		out.nodes[i] = node;
	}

	return out;
}

/*
 * Reads an input as input file 1 (node file)
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_edges(buf) {
	let out = {};

	// define and read initial values
	out.count = buf.readInt16LE(0);
	out.lengthScale = buf.readFloatLE(2);
	out.freeSpeedScale = buf.readFloatLE(6);
	out.flowRateScale = buf.readFloatLE(10);
	out.capSpeedScale = buf.readFloatLE(14);
	out.jamScale = buf.readFloatLE(18);
	out.edges = new Array(out.count);

	// read each node
	let off = 22;
	for (let i = 0; i < out.count; i++) {
		let node = {};
		off = ReadFromBufShorts(node, ["id", "start", "end"], buf, off);
		off = ReadFromBufFloats(node, ["length", "freeSpeed", "satFlowRate", "numOfLanes", "speedVar", "capSpeed", "jamDensity"], buf, off);
		off = ReadFromBufShorts(node, ["prohIndc"], buf, off);
		off = ReadFromBufInts(node, ["enableTime", "disableTime"], buf, off);
		off = ReadFromBufShorts(node, ["oppose1", "oppose2", "signal", "phase1", "phase2", "vehProhIndc", "survLevel"], buf, off);
		[off, node.tag] = ReadString(buf, off);
		out.edges[i] = node;
	}

	return out;
}

/*
 * Reads an input as input file 1 (signals file)
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_signals(buf) {
	let out = {};

	// define and read initial values
	const signalCount = buf.readInt16LE(0);
	out.planCount = buf.readInt16LE(2);
	out.planTime = buf.readInt16LE(4);
	out.planNumber = buf.readInt16LE(6);
	out.signals = [];

	// read each node
	let off = 8;
	for (let i = 0; i < signalCount; i++) {
		let node = {};
		node.signalNum = buf.readFloatLE(off + 0);
		node.baseTime = buf.readFloatLE(off + 4);
		node.minTime = buf.readFloatLE(off + 8);
		node.maxTime = buf.readFloatLE(off + 12);
		node.signalOff = buf.readInt16LE(off + 16);
		node.splitFreq = buf.readInt16LE(off + 18);
		const phaseCount = buf.readInt8(off + 20);
		node.phases = [];
		for (let ii = 0; ii < phaseCount; ii++) {
			node.phases[ii] = [];
			node.phases[ii][0] = buf.readFloatLE(off + 21 + ii * 8);
			node.phases[ii][1] = buf.readFloatLE(off + 25 + ii * 8);
		}
		out.signals[i] = node;
		off += 21 + 8 * phaseCount;
	}

	return out;
}

/*
 * File 10
 */
function ReadFile_Overview(buf) {

	let off = 0;
	let obj = {};

	// const sformat1 = "bbsbssfffffffffff";
	// const sformat2 = "bffffffff";

	obj.signals = Array(buf.readInt32LE(off));
	off += 4;

	for (let i = 0; i < obj.signals.length; i++) {
		let entry = {};
		entry.time = buf.readInt16LE(off + 0);
		entry.signal = buf.readInt16LE(off + 2);
		entry.a = Array(buf.readInt32LE(off + 4));
		off += 8;
		for (let ii = 0; ii < entry.a.length; ii++) {
			entry.a[ii] = {}
			off = ReadFromBufAny(entry.a[ii], [
				"b_ph", "b_ln", "s_link", "b_lane",
				"s_Arri Flow (vph)", "s_Saturation Flow (vph)",
				"f_Y-critical lane (%)", "f_Y-critical appr (%)", "f_Y-critical sum (%)",
				"f_Offset Time (sec)", "f_Cycle Time (sec)", "f_Lost Time (sec)", "f_Green Time (sec)",
				"f_Green Phase (sec)", "f_Inter Green (sec)", "f_Phase Start (sec)", "f_Phase End (sec)"
			], buf, off);
		}
		entry.b = Array(buf.readInt32LE(off));
		off += 4;
		for (let ii = 0; ii < entry.b.length; ii++) {
			entry.b[ii] = {};
			off = ReadFromBufAny(entry.b[ii], [
				"b_ph", "f_Offset Time (sec)", "f_Cycle Time (sec)", "f_Lost Time (sec)", "f_Green Time (sec)",
				"f_Green Phase (sec)", "f_Inter Green (sec)", "f_Phase Start", "f_Phase End (sec)"
			], buf, off);
		}
		obj.signals[i] = entry;
	}

	obj.linkFlow = Array(buf.readInt32LE(off));
	off += 4;

	// const lfformat = "sssssbfsbbifffsiss";

	for (let i = 0; i < obj.linkFlow.length; i++) {
		let entry = {};
		entry.time = buf.readInt32LE(off);
		entry.links = Array(buf.readInt32LE(off + 4));
		off += 8;
		for (let ii = 0; ii < entry.links.length; ii++) {
			entry.links[ii] = {};
			[off, entry.links[ii].Name] = ReadString(buf, off);
			off = ReadFromBufAny(entry.links[ii], [
				"s_link", "s_start", "s_end", "s_Speed", "s_Saturation",
				"b_Lanes", "f_Length", "s_Link Flow (Vehs)", "b_Grn Time (%)", "b_V/C Rat (%)",
				"i_Total Travel Time (min)", "f_Free Travel Time (min)", "f_Avg Travel Time (min)",
				"f_Avg Speed (kph)", "s_Avg Stops", "i_Max Veh Pos", "s_Max Veh Obs", "s_Cur Veh Obs"
			], buf, off);
		}
		off = ReadFromBufFloats(entry, [
			"Total Travel Time (veh-min)",
			"Total Travel Time (veh-hrs)",
			"Total Network Travel (veh-km)",
			"Total Metwork Length (km)",
			"Average Network Speed (km/h)",
			"Average Trip Time/Veh (min)",
			"avarage trip Length/Veh (km)",
			"Num Invisible Vehicles",
			"Total Network Stops",
			"Average Network Stops"
		], buf, off + 4);

		obj.linkFlow[i] = entry;
	}

	// const avgODformat1 = "bbbiisffffffffff";

	let avgOD1len = buf.readInt32LE(off);
	obj.avgOD1 = {};
	obj.avgOD1.stats = Array(avgOD1len);
	off += 4;

	for (let i = 0; i < avgOD1len; i++) {
		obj.avgOD1.stats[i] = {};
		off = ReadFromBufAny(obj.avgOD1.stats[i], [
			"b_Vehicle Type", "b_Origin Zone", "b_Destination Zone",
			"i_Number Departed", "i_Number Arrived", "s_Number Entered",
			"f_First Departure (min)", "f_Last Departure (min)", "f_First Arrival (min)", "f_Last Arrival (min)",
			"f_Total Trip Time (Veh-Min)", "f_Min Trip Time (min)", "f_Avg Trip Time (min)", "f_Max Trip Time (min)", "f_Trip Time SD (min)",
			"f_Total Distance (Veh-Km)"
		], buf, off);
	}

	const avgOD1len2 = buf.readInt32LE(off);
	obj.avgOD1.totals = [];
	off += 4;

	for (let i = 0; i < avgOD1len2; i++) {
		let entry = {};
		off = ReadFromBufAny(entry, [
			"i_class"
		], buf, off);
		if (entry["class"] != -1) {
			off = ReadFromBufAny(entry, [
				"f_Total Veh-Km", "f_Total Veh-Hrs"
			], buf, off);
			obj.avgOD1.totals.push(entry);
		}
	}

	//return obj;
	// const avgODformat2 = "bbiisfffisf";

	obj.avgOD2 = {};
	obj.avgOD2.stats = Array(buf.readInt32LE(off));
	off += 4;

	for (let i = 0; i < obj.avgOD2.stats.length; i++) {
		obj.avgOD2.stats[i] = {};
		off = ReadFromBufAny(obj.avgOD2.stats[i], [
			"b_Origin Zone", "b_Destination Zone",
			"i_Number Departed", "i_Number Arrived", "s_Number Entered",
			"f_Avg Trip Time (min)", "f_Trip Time SD (min)", "f_Total Trip Time (min)",
			"i_Max Pre-Trip Parked Vehicles", "s_Longest Pre-Trip Park Time", "f_Total Dist (Veh-Km)"
		], buf, off);
	}

	obj.avgOD2.totals = {};
	obj.avgOD2.totals["All Vehicle Classes Total Veh-Km"] = buf.readFloatLE(off + 0);
	obj.avgOD2.totals["All Vehicle Classes Total Veh-Hrs"] = buf.readFloatLE(off + 4);

	//return obj;

	off = ReadFromBufAny(obj, [
		"f_Sum of the total trip time (veh-mins)",
		"f_Sum of the total trip time (veh-hrs)",
		"f_Average trip time (mins)",
		"f_Average trip time (secs)",
		"i_Total demand to enter network",
		"i_Vehicles eligible to enter",
		"i_Vehicles in their driveways",
		"i_Vehicles left on network",
		"i_Vehicles that completed trip"
	], buf, off + 8);

	obj.incd = Array(buf.readInt32LE(off));
	off += 4;

	for (let i = 0; i < obj.incd.length; i++) {
		obj.incd[i] = {};
		off = ReadFromBufAny(obj.incd[i], [
			"i_Link",
			"i_Start node",
			"i_End node",
			"f_Start time",
			"f_End time",
			"f_Duration",
		], buf, off);
		[off, obj.incd[i]["Lane Losses"]] = ReadString(buf, off);
	}

	return obj;
}

/*
 * Reads an input as output file 11 (average traffic conditions file)
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_AvgConditions(buf) {
	let out = {};

	let off = 0;
	out.time = buf.readInt32LE(off + 0);

	const edgeCount = buf.readInt16LE(off + 4);
	out.conditions = Array(edgeCount + 1).fill({});
	out.flow = Array(edgeCount + 1).fill({});

	// 5s6fsssssss7ffffffffffff6fffAffffff9ffffff
	// 5s7s5sss7s5sss7s5sss7s5sss7s5sss

	const countA = buf.readInt16LE(off + 6);
	off += 8;

	out.edgeCount = countA;
	for (let i = 0; i < countA; i++) {
		let obj = {};
		const index = buf.readInt16LE(off);
		obj.edgeID = index;
		obj.length = buf.readFloatLE(off + 2);
		off = ReadFromBufShorts(obj, ["baseCapacity", "totalFlow"], buf, off + 6);
		[off, obj["flow"]] = ReadFromBufShortArray(buf, 5, off);
		off = ReadFromBufFloats(obj, ["freeSpeedTime", "totalAverageTime"], buf, off);
		[off, obj["averageTime"]] = ReadFromBufFloatArray(buf, 5, off);
		[off, obj["averageToll"]] = ReadFromBufFloatArray(buf, 5, off);
		off = ReadFromBufFloats(obj, ["averageVehicles", "averageQueue", "averageStops"], buf, off);
		off = ReadFromBufFloats(obj, ["fuel", "HC", "CO", "NO", "CO2", "PM"], buf, off);
		off = ReadFromBufFloats(obj, ["expectedCrashes", "expectedTopInjurt", "fatelCrashes", "crashLowDamage", "crashMedDamage", "crashHighDamage"], buf, off);
		out.conditions[index] = obj;
	}

	const countB = buf.readInt16LE(off);
	off += 2;

	for (let i = 0; i < countB; i++) {
		let obj = {};
		const index = buf.readInt16LE(off);
		obj.edgeId = index;
		off += 2;
		obj.direction = new Array(5).fill({});
		for (let ii = 0; ii < 5; ii++) {
			obj.direction[ii] = {};
			off = ReadFromBufShorts(obj.direction[ii], ["leftTurn", "through", "rightTurn", "total"], buf, off);
		}
		out.flow[index] = obj;
	}

	return out;
}

/*
 * file 12
 */
function ReadFile_Conditions(buf) {
	let out = {};

	let off = 0;
	out.periodCount = buf.readInt16LE(off + 0);
	out.time = buf.readInt32LE(off + 2);
	out.edgeCount = buf.readInt16LE(off + 6);
	out.edgeMaxID = buf.readInt16LE(off + 8);
	off += 10;

	out.periods = new Array(out.periodCount);
	for (let i = 0; i < out.periodCount; i++) {
		let periodObj = {};
		periodObj.time = buf.readInt32LE(off + 0);
		periodObj.index = buf.readInt16LE(off + 4);
		off += 6;

		// 8s9f8sssssss9fffffffCffffffffKffGffffffCfffffffCffffff

		periodObj.edges = Array(out.edgeMaxID + 1).fill({});
		for (let ii = 0; ii < out.edgeCount; ii++) {
			let obj = {};
			const index = buf.readInt16LE(off);
			obj.length = buf.readFloatLE(off + 2);
			off = ReadFromBufShorts(obj, ["baseCapacity", "totalFlow"], buf, off + 6);
			[off, obj["flow"]] = ReadFromBufShortArray(buf, 5, off);
			off = ReadFromBufFloats(obj, ["freeSpeedTime", "totalAverageTime"], buf, off);
			[off, obj["averageTime"]] = ReadFromBufFloatArray(buf, 5, off);
			[off, obj["averageToll"]] = ReadFromBufFloatArray(buf, 5, off);
			off = ReadFromBufFloats(obj, ["averageVehicles", "averageQueue", "averageStops"], buf, off);
			[off, obj["modelParameters"]] = ReadFromBufFloatArray(buf, 8, off);
			off = ReadFromBufFloats(obj, ["fuel", "HC", "CO", "NO", "CO2", "PM", "totalEnergy"], buf, off);
			off = ReadFromBufFloats(obj, ["expectedCrashes", "expectedTopInjurt", "fatelCrashes", "crashLowDamage", "crashMedDamage", "crashHighDamage"], buf, off);
			periodObj.edges[index] = obj;
		}

		out.periods[i] = periodObj;
	}

	return out;
}

/*
 * Reads an input as output file 13 (min path file)
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_paths(buf) {
	let out = {};

	// define and read initial values
	out.periodCount = buf.readInt16LE(0);
	out.time = buf.readInt32LE(2);
	let off = ReadFromBufShorts(out, ["maxOriginID", "originCount", "maxDestID", "edgeCount", "maxEdgeID"], buf, 6);

	out.periods = new Array(out.periodCount);
	for (let i = 0; i < out.periodCount; i++) {
		let periodObj = {};
		periodObj.index = buf.readInt16LE(off + 0)
		const periodVal2 = 1; // off + 2
		periodObj.treeCount = buf.readInt8(off + 3);
		off += 4;

		periodObj.paths = new Array(periodObj.treeCount);
		for (let ii = 0; ii < periodObj.treeCount; ii++) {
			let treeObj = {};
			treeObj.treeVal1 = buf.readInt8(off + 0);
			treeObj.proportion = buf.readFloatLE(off + 1);
			treeObj.index = buf.readInt8(off + 5);
			off += 6;

			treeObj.origins = new Array(out.maxOriginID).fill([]);
			treeObj.edges = new Array(out.maxEdgeID).fill([]);

			for (let Q = 0; Q < out.originCount; Q++) {
				const indx = buf.readInt16LE(off);
				[off, treeObj.origins[Q]] = ReadFromBufShortArray(buf, out.maxDestID, off + 2);
			}

			for (let Q = 0; Q < out.edgeCount; Q++) {
				const indx = buf.readInt16LE(off);
				[off, treeObj.edges[Q]] = ReadFromBufShortArray(buf, out.maxDestID, off + 2);
			}
			periodObj.paths[ii] = treeObj;
		}
		out.periods[i] = periodObj;
	}

	return out;
}

/*
 * Reads an input as output file 15 (trip probes)
 * args (queries):
 *   origin - the start/origin node to filter by. -1 means all
 *   dest - the end/destination node to filter by. -1 means all
 *   skip - the number of logs to skip. skipping starts after time0
 *   max - the max number of logs to get. default is 500
 *   stride - returns every nth log where n is this value
 *   time0 - the start time to filter by
 *   time1 - the max/cap time to filter by
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_TripProbes(buf, args) {

	const len = buf.readInt32LE(0);
	const pairC = buf.readInt32LE(4);
	let off = 8;

	// find the parameters or defaults
	let restBeg = -1;
	let restEnd = -1;
	let skip = 0;
	let max = 500;
	let stride = 1;
	let time0 = 0;
	let time1 = 999999999;
	if (args) {
		if (args.origin) // which origin node to filter by
			restBeg = args.origin;
		if (args.dest) // which destination node to filter by
			restEnd = args.dest;
		if (args.skip) // how many logs to skip
			skip = args.skip;
		if (args.max) // the max number of logs to collect
			max = args.max;
		if (args.stride) // what percentage to collect (1/stride)
			stride = args.stride;
		if (args.time0) // the min time to collect
			time0 = args.time0;
		if (args.time1) // the max time to collect, exclusive
			time1 = args.time1;
	}

	// find out how many we want
	let totalPairs = len;
	if (restBeg != -1 || restEnd != -1) {
		totalPairs = 0;
		for (let i = 0; i < pairC; i++) {
			const beg = buf.readInt16LE(off + 0);
			const end = buf.readInt16LE(off + 2);
			const quant = buf.readInt32LE(off + 4);
			const time0 = buf.readFloatLE(off + 8);
			const time1 = buf.readFloatLE(off + 12);

			if ((restBeg == -1 || beg == restBeg) && (restEnd == -1 || end == restEnd)) {
				totalPairs += quant;
				if (restBeg != -1 && restEnd != -1) {
					off += (pairC - i) * 16;
					break;
				}
			}

			off += 16;
		}
	} else if (!args || (!args.origin && !args.dest)) {
		let out = { time0: 999999999, time1: 0, total: 0 };

		out.pairs = Array(pairC).fill({});
		for (let i = 0; i < pairC; i++) {
			let obj = {};
			obj.beg = buf.readInt16LE(off + 0);
			obj.end = buf.readInt16LE(off + 2);
			obj.quant = buf.readInt32LE(off + 4);
			obj.time0 = buf.readFloatLE(off + 8);
			obj.time1 = buf.readFloatLE(off + 12);
			off += 16;

			out.time0 = Math.min(out.time0, obj.time0);
			out.time1 = Math.max(out.time1, obj.time1);
			out.total += obj.quant;

			out.pairs[i] = obj;
		}

		return out;

	} else
		off += 16 * pairC;

	let totalMax = Math.max(0, Math.min(max, Math.floor((totalPairs - skip) / stride)));
	let out = Array(totalMax);

	if (totalMax == 0)
		return out;

	let totalCount = 0;
	for (let i = 0; i < len; i++) {
		let entry = {};
		off = ReadFromBufAny(entry, [
			"f_Time simulation produced record",
			"i_Vehicle ID number", "b_Vehicle class",
			"s_Vehicle last link", "s_Origin node", "s_Destination node",
		], buf, off);
		off = ReadFromBufFloats(entry, [
			"Scheduled departure time", "Actual departure time", "Trip duration", "Total delay", "Stopped delay",
			"Number of stops", "Distance covered", "Average speed",
			"Fuel used (L)", "Hydrocarbon produced", "Carbon monoxide produced", "Nitrous oxide produced",
			"CO2 produced", "PM produced", "hydrogen consumption (kg)", // in grams
			"Number of expected crashes", "Where injury was highest level", "Where expected a fatal crash",
			"Where maximum damage was low", "Where maximum damage was moderate", "Where maximum damage was high",
			"Total toll paid", "Total acceleration noise"
		], buf, off);

		// make sure its what we are looking for
		if (entry["Time simulation produced record"] >= time0
			&& (restBeg == -1 || entry["Origin node"] == restBeg)
			&& (restEnd == -1 || entry["Destination node"] == restEnd)) {

			// limit the time
			if (entry["Time simulation produced record"] >= time1) {
				out = out.slice(0, Math.floor((totalCount - skip) / stride) + 1);
				break;
			}

			// skip some number of elements
			if (totalCount >= skip) {
				const indx = totalCount - skip;
				// only get a percentage
				if (indx % stride == 0) {
					out[indx / stride] = entry;
					// get only a limited amount
					if (indx / stride + 1 >= max) {
						break;
					}
				}
			}

			totalCount++;
		}
	}

	return out;
}

/*
 * Reads an input as output file 16 (edge probes?)
 * args (queries):
 *   edge - the edge to filter by. -1 means all
 *   skip - the number of logs to skip. skipping starts after first time0
 *   max - the max number of logs to get. Defaults to 500
 *   stride - returns every nth log where n is this value
 *   time0 - the start time to filter by
 *   time1 - the max/cap time to filter by
 * @param buf (nodejs buffer) The nodejs buffer to read from
 * @return (table) The summary file as a table/object
 */
function ReadFile_EdgeProbes(buf, args) {
	let off = 0;

	const lineC = buf.readInt32LE(off + 0);
	const edgeC = buf.readInt16LE(off + 4);
	const edgeMin = buf.readInt16LE(off + 6);
	const edgeMax = buf.readInt16LE(off + 8);
	off += 10;

	// find the parameters or defaults
	let restEdge = -1;
	let skip = 0;
	let max = 500;
	let stride = 1;
	let time0 = 0;
	let time1 = 999999999;

	if (args) {
		if (args.edge) // which edge to look for
			restEdge = args.edge;
		if (args.skip) // how many logs to skip
			skip = args.skip;
		if (args.max) // the max number of logs to collect
			max = args.max;
		if (args.stride) // what percentage to collect (1/stride)
			stride = args.stride;
		if (args.time0) // the min time to collect
			time0 = args.time0;
		if (args.time1) // the max time to collect, exclusive
			time1 = args.time1;
	}

	// get the total number of edges for the targeted edge
	let totalEdges = lineC;


	if (restEdge == -2) {
		let out = {};
		out.time0 = 999999999;
		out.time1 = 0;
		out.total = 0;
		out.edges = Array(edgeC);
		for (let i = 0; i < edgeC; i++) {
			const edgeID = buf.readInt16LE(off + 0);
			const quant = buf.readInt32LE(off + 2);
			const time0 = buf.readFloatLE(off + 6);
			const time1 = buf.readFloatLE(off + 10);

			out.edges[i] = { edgeID: edgeID, numOfLogs: quant, time0: time0, time1: time1 };
			out.time0 = Math.min(out.time0, time0);
			out.time1 = Math.max(out.time1, time1);
			out.total += quant;

			off += 14;
		}
		return out;

	} else if (restEdge != -1) {
		totalEdges = 0;
		for (let i = 0; i < edgeC; i++) {
			const edgeID = buf.readInt16LE(off + 0);
			const quant = buf.readInt32LE(off + 2);

			if (edgeID == restEdge) {
				totalEdges = quant;
				off += (edgeC - i) * 14;
				break;
			}

			off += 14;
		}
	} else
		off += edgeC * 14;


	//const format11 = "bfibsbsbssffffffffffffffffffffffff";
	//const format21 = "bfibbsbssfffffffffffffffffffffffff";

	let totalMax = Math.max(0, Math.min(max, Math.floor((totalEdges - skip) / stride)));
	let out = Array(totalMax);

	if (totalMax == 0)
		return out;


	let totalCount = 0;
	console.log(lineC);
	let objs = {};
	for (let i = 0; i < lineC; i++) {
		let obj = {};
		const type = buf.readInt8(off);
		obj.type = type;
		if (type == 11) {
			off = ReadFromBufAny(obj,
				[
					"f_time", "i_vehicleID", "b_vehicleClass", "s_edge", "b_lane",
					"s_nextEdge", "b_nextLane", "s_origin", "s_dest",
					"f_schedDepart", "f_departTime", "f_edgeTime", "f_delay",
					"f_stopDelay", "f_stops", "f_dist", "f_avgSpeed", "f_finalSpeed",
					"f_fuel", "f_HC", "f_CO", "f_NO", "f_CO2", "f_PM", "f_energy",
					"f_expectCrash", "f_expectHighInjury", "f_expectFatal",
					"f_crashLow", "f_crashMed", "f_crashHigh", "f_toll", "f_noise"
				],
				buf, off + 1);
		} else if (type == 21) {
			off = ReadFromBufAny(obj,
				[
					"f_time", "i_vehicleID", "b_vehicleClass", "b_vehicleType",
					"s_edge", "b_lane", "s_origin", "s_dest", "n1_departSched",
					"n1_departTime", "n1_edgeTime", "n3_delay", "n3_stopDelay",
					"n3_stops", "n3_dist", "n1space", "n1_speed", "f_accel",
					"n5_fuel", "n5_energyRate", "n5_HC", "n5_CO", "n5_NO", "n5_CO2", "n5_PM",
					"c1_expectCrash", "c1_expectHighInjury", "c1_expectFatal",
					"c1_crashLow", "c1_crashMed", "c1_crashHigh", "n2_toll", "n2_noise"
				],
				buf, off + 1);
		} else {
			console.log("" + type + " at " + off + ", " + i);
			return out;
		}

		// Convert `f_time` to an integer second
		let second = Math.floor(obj.time);
		let vehicleID = obj.vehicleID;

		// Group objects by second
		if (!objs[second]) {
			objs[second] = [];
		}
		objs[second].push(obj);

		// Group objects by vehicle ID
		if (!objs[vehicleID]) {
			objs[vehicleID] = [];
		}
		objs[vehicleID].push(obj);
		

		// make sure its what we are looking for
		// if((restEdge == -1 || obj.edge == restEdge) && obj.time >= time0){

		// 	// limit the time
		// 	if(obj.time >= time1){
		// 		out = out.slice(0, Math.floor((totalCount-skip)/stride) + 1);
		// 		break;
		// 	}

		// 	// skip some number of elements
		// 	if(totalCount >= skip){
		// 		const indx = totalCount - skip;
		// 		// only get a percentage
		// 		if(indx % stride == 0){
		// 			out[indx/stride] = obj;
		// 			// get only a limited amount
		// 			if(indx/stride + 1 >= max){
		// 				break;
		// 			}
		// 		}
		// 	}

		// 	totalCount++;
		// }
	}
	console.log(objs[21]);
	// console.log(objs);
	return out;
}

/*
 * Reads a file from a nodejs buffer based on type.
 * This returns whatever the corresponding function
 *   would return, which is (probably) an object/table
 * @param buf (nodejs buffer) The buffer to read from
 * @param fileType (int) The file type to read as. Use the FILE_ constants for this
 * @return (table) The interpretation of the file from the buffer
 * @throws Probably something if you use this wrong
 */
function ReadFile_Any(buf, fileType, args) {
	switch (fileType) {
		case FILE_OVERVIEW: return ReadFile_Overview(buf);
		case FILE_NODES: return ReadFile_nodes(buf);
		case FILE_EDGES: return ReadFile_edges(buf);
		case FILE_SIGNALS: return ReadFile_signals(buf);
		case FILE_SUMMARY: return ReadFile_summary(buf);
		case FILE_AVGCONDS: return ReadFile_AvgConditions(buf);
		case FILE_CONDS: return ReadFile_Conditions(buf);
		case FILE_PATHS: return ReadFile_paths(buf);
		case FILE_TRIPPROBES: return ReadFile_TripProbes(buf, args);
		case FILE_EDGEPROBES: return ReadFile_EdgeProbes(buf, args);
	}
}


/*
 * Splits a string by any number of white space.
 * Written as a function so I don't have to remember
 *  the nonsense format required to do this
 * @param line (string) The line to split into arguments
 * @return (string[]) The input split by its whitespaces
 */
function ReadLineArgs(line) {
	return line.split(/\s+/);
}

/*
 * Reads some number of elements from an array and writes
 *   them to a buffer.
 * This uses nodejsBuffer.writeFloatLE() and parseFloat()
 * @param args (String[]) The array to read from
 * @param indx (int) The starting index in the array to read from
 * @param count (int) The number of elements to read, write
 * @param buf (nodejs buffer) The buffer to write to
 * @param off (int) The starting offset in the buff to write to
 * @return (int) The resulting offset in the buffer after all writes
 */
function CopyToBufFloats(args, indx, count, buf, off) {
	for (let i = indx; i < indx + count; i++)
		off = buf.writeFloatLE(parseFloat(args[i]), off);
	return off;
}

/*
 * Reads some number of elements from an array and writes
 *   them to a buffer.
 * This uses nodejsBuffer.writeInt32LE() and parseInt()
 * @param args (String[]) The array to read from
 * @param indx (int) The starting index in the array to read from
 * @param count (int) The number of elements to read, write
 * @param buf (nodejs buffer) The buffer to write to
 * @param off (int) The starting offset in the buff to write to
 * @return (int) The resulting offset in the buffer after all writes
 */
function CopyToBufInts(args, indx, count, buf, off) {
	for (let i = indx; i < indx + count; i++)
		off = buf.writeInt32LE(parseInt(args[i]), off);
	return off;
}

/*
 * Reads some number of elements from an array and writes
 *   them to a buffer.
 * This uses nodejsBuffer.writeInt16LE() and parseInt()
 * @param args (String[]) The array to read from
 * @param indx (int) The starting index in the array to read from
 * @param count (int) The number of elements to read, write
 * @param buf (nodejs buffer) The buffer to write to
 * @param off (int) The starting offset in the buff to write to
 * @return (int) The resulting offset in the buffer after all writes
 */
function CopyToBufShorts(args, indx, count, buf, off) {
	for (let i = indx; i < indx + count; i++)
		off = buf.writeInt16LE(parseInt(args[i]), off);
	return off;
}

/*
 * Writes a string to a file by writing the length as 1 byte
 *   and then the actual string as format "ascii"
 * @param buf (nodejs buffer) The buffer to write to
 * @param str (string) The string to write
 * @param off (int) The offset in the buffer to write to
 * @return (int) The resulting offset in the buffer
 */
function WriteString(buf, str, off) {
	buf.writeInt8(str.length, off);
	buf.write(str, off + 1, str.length + 1, "ascii");
	return off + str.length + 1;
}

/*
 *
 * a bunch of nonsense
 */
function CopyToBufLine(line, buf, off, format) {
	let curOff = 0;
	let curLen = 1;
	let lastCh = "b";
	let lastNum = 0;
	for (let i = 0; i < format.length; i++) {
		let c = format.charCodeAt(i);
		if (c <= "9".charCodeAt(0)) { // set length from [0, 9]
			curLen = c - "0".charCodeAt(0);
		} else if (c <= "Z".charCodeAt(0)) { // set length from [10, ...]
			curLen = 10 + c - "A".charCodeAt(0);
		} else { // read value
			let val = line.substring(curOff, curOff + curLen);
			let ch = format.charAt(i);
			if (ch != "_") { // "_" means ignore a value
				let num;
				if (ch == "*") {
					ch = lastCh;
					num = lastNum;
				} else if (val.charAt(0) == "*") // invalid value
					num = -1;
				else if (ch == "c" || ch == "n") {
					const parts = val.split(".");
					const deci = format.charCodeAt(i + 1) - 48;
					const pow = Math.pow(10, deci);
					num = parseInt(parts[0]) * pow + parseInt(parts[1].split(0, deci));
					i++;
				} else if (ch == "s" || ch == "i" || ch == "b") // short
					num = parseInt(val);
				else if (ch == "f") // float
					num = parseFloat(val);

				switch (ch) {
					case "s": // short
						off = buf.writeInt16LE(num, off);
						break;
					case "i": // int
						off = buf.writeInt32LE(num, off);
						break;
					case "b": // byte
						off = buf.writeInt8(num, off);
						break;
					case "f": // float
						off = buf.writeFloatLE(num, off);
						break;
					case "c":
						off = buf.writeUIntLE(num, off, 2);
						break;
					case "n":
						off = buf.writeUIntLE(num, off, 3);
						break;
				}
				lastCh = ch;
				lastNum = num;
			}
			if (c != "*".charCodeAt(0))
				curOff += curLen;
		}
	}
	return off;
}

/*
 * Reads strings from an array and writes them to a nodejs buffer based on a format
 * @param args (string[]) The string array to read from
 * @param buf (nodejs) The buffer to write to
 * @param off (int) The current/starting offset of the buffer to write to
 * @param format (string) The format to use
 */
function CopyToBufArgs(args, buf, off, format) {
	let curArg = 0;
	let lastCh = "b";
	let lastNum = 0;
	for (let i = 0; i < format.length; i++) {
		let c = format.charCodeAt(i);
		let ch = format.charAt(i);
		if (c >= "a".charCodeAt(0) || ch == "_" || ch == "*") { // read value
			if (curArg >= args.length)
				return off;
			let val = args[curArg];
			if (ch != "_") { // "_" means ignore a value
				let num;
				if (ch == "*") {
					ch = lastCh;
					num = lastNum;
				} else if (val.charAt(0) == "*") // invalid value
					num = -1;
				else if (ch == "c" || ch == "n") {
					const parts = val.split(".");
					const deci = format.charCodeAt(i + 1) - 48;
					const pow = Math.pow(10, deci);
					num = parseInt(parts[0]) * pow + parseInt(parts[1].split(0, deci));
					i++;
				} else if (ch == "s" || ch == "i" || ch == "b") // short
					num = parseInt(val);
				else if (ch == "f") // float
					num = parseFloat(val);

				switch (ch) {
					case "s": // short
						off = buf.writeInt16LE(num, off);
						break;
					case "i": // int
						off = buf.writeInt32LE(num, off);
						break;
					case "b": // byte
						off = buf.writeInt8(num, off);
						break;
					case "f": // float
						off = buf.writeFloatLE(num, off);
						break;
					case "c":
						off = buf.writeUIntLE(num, off, 2);
						break;
					case "n":
						off = buf.writeUIntLE(num, off, 3);
						break;
				}
				lastNum = num;
				lastCh = ch;
			}
			if (c != "*".charCodeAt(0))
				curArg++;
		}
	}
	return off;
}

function GetLineFormatSize(format) {
	let size = 0;
	let lastCh = "b";
	for (let i = 0; i < format.length; i++) {
		let ch = format.charAt(i);
		if (ch == "*")
			ch = lastCh;
		switch (ch) {
			case "b":
				size += 1;
				break;
			case "s": case "c":
				size += 2;
				break;
			case "n":
				size += 3;
				break;
			case "i": case "f":
				size += 4;
				break;
		}
		lastCh = ch;
	}
	return size;
}


/*
 * Checks whether or not a specific file type instance already exists in
 *   a simulation
 * @param fileType (int) The file type to look for. Use FILE_...
 * @param sim_id (int) The simulation ID to look in
 * @return (int) Whether or not there exist a file
 */
async function FileExists(fileType, sim_id) {
	try {
		const [ret] = await promisePool.query("SELECT file_index FROM text_files WHERE file_type = ? AND file_sim = ?", [fileType, sim_id]);
		if (ret.length != 0)
			return 1;
	} catch (e) {
		console.error(e);
		return 1;
	}
	return 0;
}

async function FileAdd(fileType, buf, user_id, sim_id) {
	try {
		const query = "INSERT INTO text_files (file_type, file_content, file_owner, file_sim) VALUES (?, ?, ?, ?)";
		await promisePool.query(query, [fileType, buf, user_id, sim_id]);
	} catch (e) {
		console.error("Couldnt add file: ", e);
	}
}

/*
 * Reads the summary file from an array of lines and
 *  writes it into the database with the corresponding
 *  simulation and user owners
 * @param user_id (int) The user id of whom that uploaded the file
 * @param sim_id (int) The id of the simulation this file is a part of
 * @param lines (string[]) The file as an array of lines
 */
async function WriteFile_summary(user_id, sim_id, lines) {

	// make sure doesn't already exist
	if (await FileExists(FILE_SUMMARY, sim_id))
		return;


	let bonusLen = 0;
	let lineA0 = -1, lineA1 = -1, lineB0 = -1, lineB1 = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lineA0 == -1) {
			if (lines[i].includes("Total Statistics:"))
				lineA0 = i + 1;
		} else if (lineA1 == -1) {
			if (lines[i].trim().length == 0) {
				lineA1 = i;
			} else {
				bonusLen += lines[i].split("-")[1].trim().length + 1;
			}
		} else if (lineB0 == -1) {
			if (lines[i].includes("Average Statistics:"))
				lineB0 = i + 1;
		} else if (lineB1 == -1) {
			if (lines[i].trim().length == 0) {
				lineB1 = i;
				break;
			} else {
				bonusLen += lines[i].split("-")[1].trim().length + 1;
			}
		}
	}

	const lenA = lineA1 - lineA0;
	const lenB = lineB1 - lineB0;
	const totalSize = (lenA + lenB) * 4 * 6 + bonusLen + 2 + 2;
	let buf = Buffer.allocUnsafe(totalSize);
	let off = 0;

	off = buf.writeInt16LE(lenA, off);
	off = buf.writeInt16LE(lenB, off);

	for (let i = lineA0; i < lineA1; i++) {
		const line = lines[i];
		const nums = line.substring(3, 87).trim();
		const args = ReadLineArgs(nums);
		for (let ii = 0; ii < 6; ii++)
			off = buf.writeFloatLE(parseFloat(args[ii]), off);

		const tag = line.split("-")[1].trim();
		off = WriteString(buf, tag, off);
	}

	// write average stats
	for (let i = lineB0; i < lineB1; i++) {
		const line = lines[i];
		const nums = line.substring(3, 87).trim();
		const args = ReadLineArgs(nums);
		for (let ii = 0; ii < 6; ii++)
			off = buf.writeFloatLE(parseFloat(args[ii]), off);

		const tag = line.split("-")[1].trim();
		off = WriteString(buf, tag, off);
	}


	await FileAdd(FILE_SUMMARY, buf, user_id, sim_id, totalSize);
}

/*
 * Reads the node file from an array of lines and
 *  writes it into the database with the corresponding
 *  simulation and user owners
 * @param user_id (int) The user id of whom that uploaded the file
 * @param sim_id (int) The id of the simulation this file is a part of
 * @param lines (string[]) The file as an array of lines
 */
async function WriteFile_Input1(user_id, sim_id, lines) {

	// make sure doesn't already exist
	if (await FileExists(FILE_NODES, sim_id))
		return;


	const initArgs = ReadLineArgs(lines[1]);
	const nodeC = parseInt(initArgs[0]);
	const xScale = parseFloat(initArgs[1]);
	const yScale = parseFloat(initArgs[2]);

	// make sure this is the correct file type
	if (lines.length != nodeC + 3)
		return;

	// a line has a base size of 17 + 1

	// count the extra size
	let bonusSize = 0;
	for (let i = 0; i < nodeC; i++) {
		lines[2 + i] = lines[2 + i].trim();
		const args = ReadLineArgs(lines[2 + i]);
		if (args.length > 5) {
			bonusSize += args.slice(5).reduce((hoard, next) => (hoard + next.length + 1), 0);
		}
	}

	// create the buffer
	let buf = Buffer.allocUnsafe(18 * nodeC + bonusSize + 10);
	buf.writeInt16LE(nodeC, 0);
	buf.writeFloatLE(xScale, 2);
	buf.writeFloatLE(yScale, 6);

	// read the lines
	let off = 10;
	for (let i = 0; i < nodeC; i++) {
		let args = ReadLineArgs(lines[2 + i]);
		off = buf.writeInt16LE(parseInt(args[0]), off);
		off = buf.writeFloatLE(parseFloat(args[1]), off);
		off = buf.writeFloatLE(parseFloat(args[2]), off);
		off = buf.writeInt8(parseInt(args[3]), off);
		off = buf.writeInt16LE(parseInt(args[4]), off);
		off = buf.writeFloatLE(parseFloat(args[5]), off);
		const tag = args.slice(6).join(" ");
		off = WriteString(buf, tag, off);
	}


	await FileAdd(FILE_NODES, buf, user_id, sim_id);
}

/*
 * Reads the edge file from an array of lines and
 *  writes it into the database with the corresponding
 *  simulation and user owners
 * @param user_id (int) The user id of whom that uploaded the file
 * @param sim_id (int) The id of the simulation this file is a part of
 * @param lines (string[]) The file as an array of lines
 */
async function WriteFile_Input2(user_id, sim_id, lines) {

	// make sure doesn't already exist
	if (await FileExists(FILE_EDGES, sim_id))
		return;

	const initArgs = ReadLineArgs(lines[1]);
	const edgeC = parseInt(initArgs[0]);

	// count the extra size
	let bonusSize = 0;
	for (let i = 0; i < edgeC; i++) {
		lines[2 + i] = lines[2 + i].trim();
		const args = ReadLineArgs(lines[2 + i]);
		if (args.length > 20) {
			bonusSize += args.slice(20).reduce((hoard, next) => (hoard + next.length + 1), 0);
		}
	}

	// create the buffer
	// (2 + 4*5) + (2*3 + 4*7 + 2 + int*2 + 2*7 + 1 + x)
	let buf = Buffer.allocUnsafe(22 + 59 * edgeC + bonusSize);
	buf.writeInt16LE(edgeC, 0);
	CopyToBufFloats(initArgs, 1, 5, buf, 2);

	// read the lines
	let off = 22;
	for (let i = 0; i < edgeC; i++) {
		let args = ReadLineArgs(lines[2 + i]);

		off = CopyToBufShorts(args, 0, 3, buf, off);
		off = CopyToBufFloats(args, 3, 7, buf, off);
		off = CopyToBufShorts(args, 10, 1, buf, off);
		off = CopyToBufInts(args, 11, 2, buf, off);
		off = CopyToBufShorts(args, 13, 7, buf, off);
		const tag = args.slice(20).join(" ");
		off = WriteString(buf, tag, off);
	}


	await FileAdd(FILE_EDGES, buf, user_id, sim_id);
}

/*
 * Reads the signal file from an array of lines and
 *  writes it into the database with the corresponding
 *  simulation and user owners
 * @param user_id (int) The user id of whom that uploaded the file
 * @param sim_id (int) The id of the simulation this file is a part of
 * @param lines (string[]) The file as an array of lines
 */
async function WriteFile_Input3(user_id, sim_id, lines) {

	// make sure doesn't already exist
	if (await FileExists(FILE_SIGNALS, sim_id))
		return;

	const initArgs = ReadLineArgs(lines[1]);
	const signalC = parseInt(initArgs[0]);
	const planC = parseInt(initArgs[1]);
	const planTime = parseInt(initArgs[2]);
	const planNumber = parseInt(lines[2].trim());

	// make sure this is the correct file. This is bad due to lack
	//   of documentation
	if (lines.length != signalC + 4)
		return;

	// calculate entry variable size
	let varSize = 0;
	for (let i = 0; i < signalC; i++) {
		const args = ReadLineArgs(lines[3 + i].trim());
		varSize += 8 * parseInt(args[5]);
	}

	// create the buffer
	// 2 + 2 + 2 + 2 = 8
	// 4 + 4 + 4 + 4 + 2 + 1 + 2 = 21
	let buf = Buffer.allocUnsafe(8 + 21 * signalC + varSize);
	buf.writeInt16LE(signalC, 0);
	buf.writeInt16LE(planC, 2);
	buf.writeInt16LE(planTime, 4);
	buf.writeInt16LE(planNumber, 6);

	// read the lines
	let off = 8;
	for (let i = 0; i < signalC; i++) {
		let args = ReadLineArgs(lines[3 + i]);
		off = buf.writeFloatLE(parseFloat(args[0]), off);
		off = buf.writeFloatLE(parseFloat(args[1]), off);
		off = buf.writeFloatLE(parseFloat(args[2]), off);
		off = buf.writeFloatLE(parseFloat(args[3]), off);
		off = buf.writeInt16LE(parseInt(args[4]), off);
		off = buf.writeInt16LE(parseFloat(args[-1]), off);
		const phaseC = parseFloat(args[5]);
		off = buf.writeInt8(phaseC, off);
		for (let ii = 0; ii < phaseC; ii++) {
			off = buf.writeFloatLE(parseFloat(args[6 + ii * 2]), off);
			off = buf.writeFloatLE(parseFloat(args[7 + ii * 2]), off);
		}
	}


	await FileAdd(FILE_SIGNALS, buf, user_id, sim_id);
}

/*
 * File 10
 */
async function WriteFile_Overview(user_id, sim_id, lines) {

	if (await FileExists(FILE_OVERVIEW, sim_id))
		return;

	// formats for the "Signal Timing Plan Summary" section
	const sformat1 = "bbsbssfffffffffff";
	const sformat2 = "bffffffff";
	const sformat1Size = GetLineFormatSize(sformat1);
	const sformat2Size = GetLineFormatSize(sformat2);

	const lfformat = "sssssbfsbbifffsiss";
	const lfformatSize = GetLineFormatSize(lfformat);

	const avgODformat1 = "bbbiisffffffffff";
	const avgODformat2 = "bbiisfffisf";
	const avgODformat1Size = GetLineFormatSize(avgODformat1);
	const avgODformat2Size = GetLineFormatSize(avgODformat2);

	let totalSize = 0;

	let obj = {};
	obj.signals = [];
	totalSize += 4;
	obj.linkFlow = [];
	totalSize += 4;
	obj.avgOD1 = { stats: [], totals: [] };
	totalSize += 4;
	obj.avgOD2 = { stats: [], totals: [] };
	totalSize += 4;
	totalSize += 8;
	obj.garbage = Array(9).fill(0);
	totalSize += obj.garbage.length * 4;
	obj.incd = [];
	totalSize += 4;

	for (let i = 0; i < lines.length; i++) {
		//console.log(lines[i]);
		if (lines[i].startsWith(" Timing Optimization at")) {
			if (i + 5 >= lines.length) return;
			let entry = {};
			let dotPos = lines[i].indexOf(".");
			if (dotPos == -1) return;
			let time = parseInt(lines[i].substring(23, dotPos));
			let id = parseInt(ReadLineArgs(lines[i].trim())[7]);
			if (time == NaN || id == NaN) return;
			entry.time = time;
			entry.signal = id;
			totalSize += 8;
			// read the first section of stuffs
			i += 5;
			totalSize += 4;
			entry.a = [];
			while (lines[i].trim().length > 0) {
				let lineArgs = ReadLineArgs(lines[i].trim());
				if (lineArgs.length != 17) return;
				entry.a.push(lineArgs);
				totalSize += sformat1Size;
				i++;
			}
			// read the second section of stuff
			i += 4;
			if (i >= lines.length) return;
			totalSize += 4;
			entry.b = [];
			while (lines[i].trim().length > 0) {
				let lineArgs = ReadLineArgs(lines[i].trim());
				if (lineArgs.length != 9) return;
				entry.b.push(lineArgs);
				totalSize += sformat2Size;
				i++;
			}
			obj.signals.push(entry);
		} else if (lines[i].startsWith(" LINK FLOW SUMMARIES AT TIME:")) {
			let dotPos = lines[i].indexOf(".");
			let time = parseInt(lines[i].substring(29), dotPos);
			if (time == NaN) return;
			let entry = {};
			entry.time = time;
			totalSize += 4;
			i += 6;
			if (i >= lines.length) return;
			entry.edges = [];
			totalSize += 4;
			while (lines[i].trim().length > 0) {
				let name = lines[i].substring(19, 19 + 19).trim();
				let notName = lines[i].substring(0, 19) + lines[i].substring(19 + 19);
				let lineArgs = ReadLineArgs(notName.trim());
				if (lineArgs.length != 18) return;
				entry.edges.push({
					name: name,
					a: lineArgs
				});
				totalSize += lfformatSize + name.length + 1; // name is 19 bytes
				i++;
			}

			i++;
			totalSize += 4;
			entry.b = Array(10);
			for (let q = 0; q < 10; q++, i++) {
				entry.b[q] = parseFloat(lines[i].substring(27, 40).trim());
				if (entry.b[q] == NaN) return;
				if (q == 3) i++; // skip the random empty line
				totalSize += 4;
			}
			obj.linkFlow.push(entry);

		} else if (lines[i].startsWith(" AVERAGE/TOTAL O-D TRIP TIMES/DISTANCES BY VEHICLE TYPE")) {
			i += 6;
			if (i >= lines.length) return;
			totalSize += 4;
			while (lines[i].trim().length > 0) {
				let lineArgs = ReadLineArgs(lines[i].trim());
				if (lineArgs.length != 16) return;
				obj.avgOD1.stats.push(lineArgs);
				totalSize += avgODformat1Size;
				i++;
			}
			i++;
			totalSize += 4;
			while (lines[i].trim().length > 0) {
				if (!lines[i].startsWith(" - Vehicle class :"))
					break;

				const clas = parseInt(lines[i].substring(18, 28));
				const name = lines[i].substring(29, 29 + 13).trim();
				const val = lines[i].substring(43);

				if (!obj.avgOD1.totals[clas]) {
					obj.avgOD1.totals[clas] = { "class": clas, "Total Veh-Km": 0, "Total Veh-Hrs": 0 };
					totalSize += 12;
				}

				obj.avgOD1.totals[clas][name] = val;
				i++;
			}
		} else if (lines[i].startsWith(" AVERAGE/TOTAL O-D TRIP TIMES/DISTANCES FOR ALL VEHICLE CLASSES")) {
			i += 5;
			if (i >= lines.length) return;
			totalSize += 4;
			while (lines[i + 2].trim().length > 0) {
				let lineArgs = ReadLineArgs(lines[i].trim());
				if (lineArgs.length != avgODformat2.length) return;
				obj.avgOD2.stats.push(lineArgs);
				totalSize += avgODformat2Size;
				i++;
			}
			obj.avgOD2.totals[0] = parseFloat(lines[i + 0].substring(44).trim());
			obj.avgOD2.totals[1] = parseFloat(lines[i + 1].substring(44).trim());
		} else if (lines[i].startsWith(" Sum of the total trip time     =")) {
			const lineArgs = ReadLineArgs(lines[i].substring(33).trim());
			obj.garbage[0] = parseFloat(lineArgs[0]);
			obj.garbage[1] = parseFloat(lineArgs[2]);
		} else if (lines[i].startsWith(" Average          trip time     =")) {
			const lineArgs = ReadLineArgs(lines[i].substring(33).trim());
			obj.garbage[2] = parseFloat(lineArgs[0]);
			obj.garbage[3] = parseFloat(lineArgs[2]);
		} else if (lines[i].startsWith("  Total demand to enter network =")) {
			obj.garbage[4] = parseInt(lines[i].substring(33).trim());
		} else if (lines[i].startsWith("  Vehicles eligible to enter    =")) {
			obj.garbage[5] = parseInt(lines[i].substring(33).trim());
		} else if (lines[i].startsWith("  Vehicles in their driveways   =")) {
			obj.garbage[6] = parseInt(lines[i].substring(33).trim());
		} else if (lines[i].startsWith("  Vehicles left on network      =")) {
			obj.garbage[7] = parseInt(lines[i].substring(33).trim());
		} else if (lines[i].startsWith("  Vehicles that completed trip  =")) {
			obj.garbage[8] = parseInt(lines[i].substring(33).trim());
		} else if (lines[i].startsWith(" INCIDENT")) {
			if (i + 2 >= lines.length) return;
			const splits = ReadLineArgs(lines[i].trim());
			let entry = {};
			entry.id = parseInt(splits[1]);
			entry.edge = parseInt(splits[4]);
			entry.node0 = parseInt(splits[6]);
			entry.node1 = parseInt(splits[8]);
			i++;
			entry.losses = lines[i].substring(14).trim();
			i++;
			const splits2 = ReadLineArgs(lines[i].trim());
			entry.time0 = parseFloat(splits2[2]);
			entry.time1 = parseFloat(splits2[7]);
			entry.len = parseFloat(splits2[11]);
			obj.incd.push(entry);
			totalSize += 4 * 7 + entry.losses.length + 1;
		}
	}

	let off = 0;
	let buf = Buffer.allocUnsafe(totalSize);

	// write the traffic signal stuff
	off = buf.writeInt32LE(obj.signals.length, off);
	for (let i = 0; i < obj.signals.length; i++) {
		off = buf.writeInt16LE(obj.signals[i].time, off);
		off = buf.writeInt16LE(obj.signals[i].signal, off);
		off = buf.writeInt32LE(obj.signals[i].a.length, off);
		for (let ii = 0; ii < obj.signals[i].a.length; ii++)
			off = CopyToBufArgs(obj.signals[i].a[ii], buf, off, sformat1);
		off = buf.writeInt32LE(obj.signals[i].b.length, off);
		for (let ii = 0; ii < obj.signals[i].b.length; ii++)
			off = CopyToBufArgs(obj.signals[i].b[ii], buf, off, sformat2);
	}

	// link flow summaries
	off = buf.writeInt32LE(obj.linkFlow.length, off);
	for (let ii = 0; ii < obj.linkFlow.length; ii++) {
		off = buf.writeInt32LE(obj.linkFlow[ii].time, off);
		off = buf.writeInt32LE(obj.linkFlow[ii].edges.length, off);
		for (let i = 0; i < obj.linkFlow[ii].edges.length; i++) {
			off = WriteString(buf, obj.linkFlow[ii].edges[i].name, off);
			off = CopyToBufArgs(obj.linkFlow[ii].edges[i].a, buf, off, lfformat);
		}
		off = buf.writeInt32LE(obj.linkFlow[ii].b.length, off);
		for (let i = 0; i < obj.linkFlow[ii].b.length; i++) {
			off = buf.writeFloatLE(obj.linkFlow[ii].b[i], off);
		}
	}

	// average OD by type
	off = buf.writeInt32LE(obj.avgOD1.stats.length, off);
	for (let i = 0; i < obj.avgOD1.stats.length; i++)
		off = CopyToBufArgs(obj.avgOD1.stats[i], buf, off, avgODformat1);
	off = buf.writeInt32LE(obj.avgOD1.totals.length, off);
	for (const entry of obj.avgOD1.totals) {
		if (!entry) {
			off = buf.writeInt32LE(-1, off);
		} else {
			off = buf.writeInt32LE(entry["class"], off);
			off = buf.writeFloatLE(entry["Total Veh-Km"], off);
			off = buf.writeFloatLE(entry["Total Veh-Hrs"], off);
		}
	}

	// average OD overal
	off = buf.writeInt32LE(obj.avgOD2.stats.length, off);
	for (let i = 0; i < obj.avgOD2.stats.length; i++)
		off = CopyToBufArgs(obj.avgOD2.stats[i], buf, off, avgODformat2);
	off = buf.writeFloatLE(obj.avgOD2.totals[0], off);
	off = buf.writeFloatLE(obj.avgOD2.totals[1], off);

	// write garbage at the end
	for (let i = 0; i < 4; i++)
		off = buf.writeFloatLE(obj.garbage[i], off);
	for (let i = 4; i < 9; i++)
		off = buf.writeInt32LE(obj.garbage[i], off);


	off = buf.writeInt32LE(obj.incd.length, off);
	for (let i = 0; i < obj.incd.length; i++) {
		off = buf.writeInt32LE(obj.incd[i].edge, off);
		off = buf.writeInt32LE(obj.incd[i].node0, off);
		off = buf.writeInt32LE(obj.incd[i].node1, off);
		off = buf.writeFloatLE(obj.incd[i].time0, off);
		off = buf.writeFloatLE(obj.incd[i].time1, off);
		off = buf.writeFloatLE(obj.incd[i].len, off);
		off = WriteString(buf, obj.incd[i].losses, off);
	}

	//console.log(off,"/",totalSize);

	await FileAdd(FILE_OVERVIEW, buf, user_id, sim_id);
}

/*
 * File 11
 */
async function WriteFile_AvgConditions(user_id, sim_id, lines) {

	if (await FileExists(FILE_AVGCONDS, sim_id))
		return;


	let formatType; // distributed of provided formated file
	let lineA0 = -1, lineA1 = -1; // start and of the first section
	let lineB0, lineB1; // start and end of the second secction
	let targLen;
	for (let i = 0; i < lines.length; i++) {
		if (lineA0 == -1) {
			if (lines[i].length == 269 || lines[i].length == 312) {
				lineA0 = i;
				formatType = (lines[i].length == 270) ? 1 : 0;
				targLen = lines[i].length;
			}
		} else {
			if (lines[i].trim() === "Turning movements by dir and veh class") {
				lineA1 = i;
				break;
			} else if (lines[i].length != targLen)
				return;
		}
	}
	lineB0 = lineA1 + 2;
	lineB1 = lines.length;

	const formatA = formatType ?
		"5s6fsssssss7ffffffffffff6fffAffffff9ffffff" : // distributed
		"5s6fsssssss7ffffffffffff5_6fffEffffff_9ffffff"; // provided
	const formatB = "5s7s5sss7s5sss7s5sss7s5sss7s5sss";

	const entryASize = GetLineFormatSize(formatA);
	const entryBSize = GetLineFormatSize(formatB);
	const lineCA = lineA1 - lineA0;
	const lineCB = lineB1 - lineB0;
	const totalSize = entryASize * lineCA + entryBSize * lineCB + 4 + 2 + 2 + 2;

	let off = 0;
	let buf = Buffer.allocUnsafe(totalSize);

	let initArgs = ReadLineArgs(lines[lineB0 - 1].trim());
	off = buf.writeInt32LE(parseInt(initArgs[0]), off); // sim time
	off = buf.writeInt16LE(parseInt(initArgs[1]), off); // max edge ID

	off = buf.writeInt16LE(lineCA, off);
	for (let i = 0; i < lineCA; i++)
		off = CopyToBufLine(lines[lineA0 + i], buf, off, formatA);

	off = buf.writeInt16LE(lineCB, off);
	for (let i = 0; i < lineCB; i++)
		off = CopyToBufLine(lines[lineB0 + i], buf, off, formatB);


	await FileAdd(FILE_AVGCONDS, buf, user_id, sim_id);
}

/*
 * File 12
 */
async function WriteFile_Conditions(user_id, sim_id, lines) {

	if (await FileExists(FILE_CONDS, sim_id))
		return;

	let initArgs = ReadLineArgs(lines[1].trim());
	const periodC = parseInt(initArgs[0]);
	const edgeC = parseInt(initArgs[2]);

	const format = "8s9f8sssssss9fffffffCffffffffKffGffffffCfffffffCffffff"; //9

	const formatSize = GetLineFormatSize(format);
	const periodSize = formatSize * edgeC + 4 + 2;
	const totalSize = 2 + 4 + 2 + 2 + periodSize * periodC;

	let off = 0;
	let buf = Buffer.allocUnsafe(totalSize);

	off = buf.writeInt16LE(parseInt(initArgs[0]), off); // period count
	off = buf.writeInt32LE(parseInt(initArgs[1]), off); // sim time
	off = buf.writeInt16LE(parseInt(initArgs[2]), off); // edge count
	off = buf.writeInt16LE(parseInt(initArgs[3]), off); // max edge ID

	let curLine = 2;
	for (let i = 0; i < periodC; i++) {
		const lineArgs = ReadLineArgs(lines[curLine].trim());
		off = buf.writeInt32LE(parseInt(lineArgs[0]), off);
		off = buf.writeInt16LE(parseInt(lineArgs[1]), off);
		for (let ii = 0; ii < edgeC; ii++)
			off = CopyToBufLine(lines[curLine + 1 + ii], buf, off, format);
		curLine += edgeC + 1;
	}

	await FileAdd(FILE_CONDS, buf, user_id, sim_id);
}

/*
 * file 15
 */
async function WriteFile_TripProbes(user_id, sim_id, lines) {

	if (await FileExists(FILE_TRIPPROBES, sim_id))
		return;


	//const format = "3_8fi2b"; //9
	const preLine = ((lines[0].charAt(2) == "1") && Math.abs(lines[0].split(/\s+/).length - 29.5) == 0.5) ? 0 : 1;
	const lineC = lines.length - 1;
	const formatA = "_fibsssffffffffffffff*ffffffff";
	const formatB = "_fibsssfffffffffffffffffffffff";

	// count the number
	let pairs = [];
	for (let i = preLine; i < lineC; i++) {
		if (lines[i].length != 278 && lines[i].length != 266)
			return;
		const beg = parseInt(lines[i].substring(27, 32));
		const end = parseInt(lines[i].substring(32, 37));
		const time = parseFloat(lines[i].substring(3, 11));
		let found = pairs.find((element) => element.beg == beg && element.end == end);
		if (!found) {
			let obj = {
				beg: beg,
				end: end,
				quant: 1,
				time1: time,
				time0: time
			};
			pairs.push(obj);
		} else {
			found.quant++;
			found.time1 = time;
		}
	}


	const formatSize = GetLineFormatSize(formatA);
	const totalSize = formatSize * (lineC - preLine) + 4 + 4 + pairs.length * (2 + 2 + 4 + 4 + 4);

	let off = 0;
	let buf = Buffer.allocUnsafe(totalSize);

	off = buf.writeInt32LE(lineC - preLine, off); // number of lines
	off = buf.writeInt32LE(pairs.length, off);

	for (let i = 0; i < pairs.length; i++) {
		off = buf.writeInt16LE(pairs[i].beg, off);
		off = buf.writeInt16LE(pairs[i].end, off);
		off = buf.writeInt32LE(pairs[i].quant, off);
		off = buf.writeFloatLE(pairs[i].time0, off);
		off = buf.writeFloatLE(pairs[i].time1, off);
	}

	for (let i = preLine; i < lineC; i++) {
		const lineArgs = ReadLineArgs(lines[i].trim());
		if (lineArgs.length == 29)
			off = CopyToBufArgs(lineArgs, buf, off, formatA);
		else if (lineArgs.length == 30)
			off = CopyToBufArgs(lineArgs, buf, off, formatB);
		else {
			//console.log(i, lineArgs.length);
			return;
		}

	}


	await FileAdd(FILE_TRIPPROBES, buf, user_id, sim_id);
}

/*
 * file 16
 */
async function WriteFile_EdgeProbes(user_id, sim_id, lines) {

	if (await FileExists(FILE_EDGEPROBES, sim_id))
		return;

	const preLine = ((lines[0].startsWith(" 11") || lines[0].startsWith(" 21")) && Math.abs(lines[0].trim().split(/\s+/).length - 33.5) == 0.5) ? 0 : 1;
	const lineC = lines.length - 1;
	const format11A = "bfibsbsbssffffffffffffffffffffffff";
	const format11B = "bfibsbsbssfffffffffffffff*ffffffff";
	const format21 = "bfibbsbs" +
		"sn1n1n1n3n3n3n3" +
		"n1n1fn5n5n5n5n5" +
		"n5n5c1c1c1c1c1c1" +
		"n2n2";

	let format11C = 0, format21C = 0;
	let links = [];
	let minLink = 9999;
	let maxLink = 0;
	for (let i = preLine; i < lineC; i++) {
		const kind = lines[i].substring(1, 3);
		let edge;
		if (kind === "11") {
			edge = parseInt(lines[i].substring(22, 28));
			format11C++;
		} else if (kind === "21") {
			edge = parseInt(lines[i].substring(21, 27));
			format21C++;
		} else if (i < lineC - 1)
			return;

		if (!links.some((element) => element.edge == edge)) {
			links.push({ edge: edge, quant: 0, time1: 0, time0: 999999999 });
			if (edge < minLink)
				minLink = edge;
			if (edge > maxLink)
				maxLink = edge;
		}
	}

	const format11Size = GetLineFormatSize(format11A);
	const format21Size = GetLineFormatSize(format21);
	const headSize = 4 + 2 + 2 + 2 + links.length * 14;
	const totalSize = format11Size * format11C + format21Size * format21C + headSize;

	let off = 0;
	let buf = Buffer.allocUnsafe(totalSize);

	off = buf.writeInt32LE(lineC - preLine, 0);
	off = buf.writeInt16LE(links.length, off);
	off = buf.writeInt16LE(minLink, off);
	off = buf.writeInt16LE(maxLink, off);
	//off = buf.writeInt16LE(lineC, off);
	//off = buf.writeInt16LE(lineC, off);
	off += links.length * 14;


	let linkMap = Array(maxLink - minLink + 1).fill(0);

	for (let i = 0; i < links.length; i++)
		linkMap[links[i].edge - minLink] = i;

	for (let i = preLine; i < lineC; i++) {
		const lineArgs = ReadLineArgs(lines[i].trim());
		let edge;
		if (lineArgs[0] == "11") {
			off = CopyToBufArgs(lineArgs, buf, off, lineArgs.length == 33 ? format11B : format11A);
			edge = parseInt(lineArgs[4]);
		} else {
			off = CopyToBufArgs(lineArgs, buf, off, format21);
			edge = parseInt(lineArgs[5]);
		}
		let indx = linkMap[edge - minLink];
		if (!links[indx].time0)
			links[indx].time0 = parseFloat(lineArgs[1]);
		else
			links[indx].time1 = parseFloat(lineArgs[1]);
		links[indx].quant++;
	}

	//console.log("" + off + "/" + totalSize);

	off = 10;
	for (let i = 0; i < links.length; i++) {
		off = buf.writeInt16LE(links[i].edge, off);
		off = buf.writeInt32LE(links[i].quant, off);
		off = buf.writeFloatLE(links[i].time0, off);
		off = buf.writeFloatLE(links[i].time1, off);
	}

	await FileAdd(FILE_EDGEPROBES, buf, user_id, sim_id);
}


/*
 * Reads the min path file from an array of lines and
 *  writes it into the database with the corresponding
 *  simulation and user owners
 * @param user_id (int) The user id of whom that uploaded the file
 * @param sim_id (int) The id of the simulation this file is a part of
 * @param lines (string[]) The file as an array of lines
 */
async function WriteFile_MinTree(user_id, sim_id, lines) {

	// make sure doesn't already exist
	if (await FileExists(FILE_PATHS, sim_id))
		return;

	// 0 numberOfPeriods
	// 1 time
	// 2 maxStartID
	// 3 startCount
	// 4 endCount/maxEndID
	// 5 edgeCount
	// 6 maxEdgeID

	// period index
	// number of trees per proportion thing?
	// number of "trees" in this section

	// number of trees in proportion? (always 1? matches with)
	// proportion
	// index of section

	const initArgs = ReadLineArgs(lines[1].trim());
	const periodC = parseInt(initArgs[0]);
	const startC = parseInt(initArgs[3]);
	const endC = parseInt(initArgs[4]);
	const edgeC = parseInt(initArgs[5]);

	const entriesPerTree = startC + edgeC;
	const linesPerEntry = Math.floor((endC + 14) / 15);
	const linesPerTree = entriesPerTree * linesPerEntry + 1;
	const bytesPerTree = 1 + 4 + 1 + ((endC + 1) * entriesPerTree) * 2;

	// size of base line
	let varSize = (2 + 4 + 2 + 2 + 2 + 2 + 2);
	let curLine = 2;
	for (let i = 0; i < periodC; i++) {
		const args = ReadLineArgs(lines[curLine].trim());
		if (args.length != 3) return;
		const treeC = parseInt(args[2]);
		// size of period info + size of trees
		varSize += (2 + 1 + 1) + bytesPerTree * treeC;
		curLine += linesPerTree * treeC + 1;
		if (curLine > lines.length) return;
	}

	let off = 0;
	let buf = Buffer.allocUnsafe(varSize);
	off = CopyToBufShorts(initArgs, 0, 1, buf, off);
	off = CopyToBufInts(initArgs, 1, 1, buf, off);
	off = CopyToBufShorts(initArgs, 2, 5, buf, off);

	curLine = 2;
	for (let i = 0; i < periodC; i++) {
		const periodArgs = ReadLineArgs(lines[curLine].trim());
		const periodIndx = parseInt(periodArgs[0]);
		const treeC = parseInt(periodArgs[2]);

		if (periodIndx != i + 1) {
			console.log("Bad file13: period " + periodIndx + " != " + (i + 1));
			throw "bad file13: period indx";
		}

		off = buf.writeInt16LE(periodIndx, off);
		off = buf.writeInt8(parseInt(periodArgs[1]), off);
		off = buf.writeInt8(treeC, off);
		curLine++;

		for (let ii = 0; ii < treeC; ii++) {
			const treeArgs = ReadLineArgs(lines[curLine].trim());
			off = buf.writeInt8(parseInt(treeArgs[0]), off);
			off = buf.writeFloatLE(parseFloat(treeArgs[1]), off);
			off = buf.writeInt8(parseInt(treeArgs[2]), off);
			curLine++;

			for (let Q = 0; Q < entriesPerTree; Q++) {
				for (let QQ = 0; QQ < linesPerEntry; QQ++) {
					const entryArgs = ReadLineArgs(lines[curLine].trim());
					off = CopyToBufShorts(entryArgs, 0, entryArgs.length, buf, off);
					curLine++;
				}
			}
		}
	}

	await FileAdd(FILE_PATHS, buf, user_id, sim_id);
}


/*
 * Takes a file as a string, determines which file it
 *   is, then reads it according to this conclusion and
 *   writes the output into the database at the specified
 *   user and simulation owners
 * @param user_id (int) The user id of whom that uploaded the file
 * @param sim_id (int) The id of the simulation this file is a part of
 * @param str (string) The file as a string
 */
async function ReadFile(user_id, sim_id, str, fileName) {
	try {
		if (!fileName) {
			fileName = "";
			console.log("No file name");
		}
		//console.log("Reading in file name: "+fileName);
		const lines = str.split(/\r?\n/); // end of line, but can work with only \n

		const summaryFileRegex = /.*summary.*\.out$/i;
		const nodesRegex = /.*1.*\.dat$/i;
		const edgesRegex = /.*2.*\.dat$/i;
		const signalsRegex = /.*3.*\.dat$/i;
		const averageTrafficConditionsRegex = /.*11.*\.out$/i;
		const trafficConditionsRegex = /.*12.*\.out$/i;
		const pathsRegex = /.*13.*\.out$/i;
		const tripProbesRegex = /.*15.*\.out$/i;
		const roadProbesRegex = /.*16.*\.out$/i;
		const overviewRegex = /.*10.*\.out$/i;

		// this is bad, but good enough
		if (lines.length < 4)
			return;

		// Check if it's a summary file 
		if (summaryFileRegex.test(fileName))
			return await WriteFile_summary(user_id, sim_id, lines); // output file summary
		else if (signalsRegex.test(fileName))
			return await WriteFile_Input3(user_id, sim_id, lines); // input file 3 signals
		else if (nodesRegex.test(fileName))
			return await WriteFile_Input1(user_id, sim_id, lines); // input file 1 nodes
		else if (edgesRegex.test(fileName))
			return await WriteFile_Input2(user_id, sim_id, lines); // input file 2 edges
		else if (pathsRegex.test(fileName))
			return await WriteFile_MinTree(user_id, sim_id, lines); // output file 13
		else if (averageTrafficConditionsRegex.test(fileName))
			return await WriteFile_AvgConditions(user_id, sim_id, lines); // output file 11
		else if (trafficConditionsRegex.test(fileName))
			return await WriteFile_Conditions(user_id, sim_id, lines); // output file 12
		else if (tripProbesRegex.test(fileName))
			return await WriteFile_TripProbes(user_id, sim_id, lines); // output file 15
		else if (roadProbesRegex.test(fileName))
			return await WriteFile_EdgeProbes(user_id, sim_id, lines); // output file 16
		else if (overviewRegex.test(fileName))
			return await WriteFile_Overview(user_id, sim_id, lines); // output file 10

	} catch (error) {
		console.error("Couldnt read file: (" + fileName + ") ", error);
	}
	// 4 -> file 11, 12
	// 7 -> file 13
	// 29 -> file 15
	// 34 -> file 16
	// 3 -> file 1, 3
	//   line 2: 1 -> 3
	// 6 -> file 2

}


function FileTypeToName(fileType) {
	const FILE_NAMES = [
	/*0*/"Simulation Details",
	/*1*/"Average Traffic Conditions",
	/*2*/"Traffic Conditions",
	/*3*/"Paths",
	/*4*/"Summary",
	/*5*/"Trip Completion Probes",
	/*6*/"Road Probes",
	/*7*/"Nodes",
	/*8*/"Edges",
	/*9*/"Signals"
	];
	return FILE_NAMES[fileType];
}

function FileNumToFileType(fileNum) {
	switch (fileNum) {
		case 10: return 0;
		case 11: return 1;
		case 12: return 2;
		case 13: return 3;
		case 1: return 4;
		case 15: return 5;
		case 16: return 6;

	}
}






