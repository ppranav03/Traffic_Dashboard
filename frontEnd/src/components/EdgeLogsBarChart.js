// EdgeLogsBarChart.js

import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import axios from 'axios';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function EdgeLogsBarChart({ dimensions, selectedGraph, expandedCollection }) {
  const [edgeData, setEdgeData] = useState([]);
  useEffect(() => {
    const fetchEdgeData = async () => {
      if (!expandedCollection) return;
      const token = sessionStorage.getItem('token');
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}:${process.env.REACT_APP_API_BACKEND_PORT}/api/file-edgeprobes`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              sim: expandedCollection,
            },
          }
        );
        // console.log('Fetched edge data:', response.data.edges);
        console.log('Fetched file 16 data:', response.data);
        setEdgeData(response.data || []);
      } catch (error) {
        console.error('Error fetching edge data:', error);
      }
    };
    fetchEdgeData();
  }, [expandedCollection]);



  // Prepare data for the chart
  // const sortedEdges = edgeData.sort((a, b) => b.numOfLogs - a.numOfLogs);
  // const topEdges = sortedEdges.slice(0, 20); // Display top 20 edges

  // const data = {
  //   labels: topEdges.map((edge) => `Edge ${edge.edgeID}`),
  //   datasets: [
  //     {
  //       label: 'Number of Logs',
  //       data: topEdges.map((edge) => edge.numOfLogs),
  //       backgroundColor: 'rgba(75,192,192,0.6)',
  //       borderColor: 'rgba(75,192,192,1)',
  //       borderWidth: 1,
  //     },
  //   ],
  // };

  // const options = {
  //   indexAxis: 'y',
  //   scales: {
  //     x: {
  //       beginAtZero: true,
  //       title: {
  //         display: true,
  //         text: 'Number of Logs',
  //       },
  //     },
  //     y: {
  //       title: {
  //         display: true,
  //         text: 'Edge ID',
  //       },
  //     },
  //   },
  //   plugins: {
  //     legend: {
  //       display: false,
  //     },
  //   },
  //   maintainAspectRatio: false,
  // };

  console.log(edgeData);

  const [currentSecond, setCurrentSecond] = useState(0);
  const [minSec, setMinSec] = useState(0);
  const [maxSec, setMaxSec] = useState(0);
  const [vehicle80, setVehicle80] = useState([]);



  // Update state when edgeData changes
  useEffect(() => {
    if (edgeData?.data?.length > 0) {
      const filtered = edgeData.data.filter(obj => obj.vehicle_id === 80);
      const times = filtered.map(obj => obj.simulation_time_sec);

      if (times.length > 0) {
        const min = Math.min(...times);
        const max = Math.max(...times);

        setVehicle80(filtered);
        setMinSec(min);
        setMaxSec(max);
        setCurrentSecond(min); // start at the first second
      }
    }
  }, [edgeData]);

  console.log(vehicle80);

  const currentData = vehicle80.filter(row => Math.floor(row.simulation_time_sec) === currentSecond);

  if (edgeData.length === 0) {
    return <div>Loading Edge Data...</div>;
  }

  return (
    <div style={{ width: dimensions.graphWidth, height: dimensions.graphHeight, padding: '1rem' }}>
      <h3>Vehicle ID: 80</h3>

      <input
        type="range"
        min={minSec}
        max={maxSec}
        value={currentSecond}
        onChange={(e) => setCurrentSecond(parseInt(e.target.value))}
        style={{ width: '100%' }}
      />
      <p>Showing data for simulation second: <strong>{currentSecond}</strong></p>

      <table border="1" cellPadding="8" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Link</th>
            <th>Lane</th>
            <th>Speed</th>
            <th>Distance</th>
            <th>Fuel</th>
          </tr>
        </thead>
        <tbody>
          {currentData.length > 0 ? (
            currentData.map((row, idx) => (
              <tr key={idx}>
                <td>{row.simulation_time_sec}</td>
                <td>{row.current_link}</td>
                <td>{row.current_lane}</td>
                <td>{row.average_speed_kmh ?? 'N/A'}</td>
                <td>{row.distance_covered_km}</td>
                <td>{row.fuel_used_liters}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan="6">No data for this second</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default EdgeLogsBarChart;