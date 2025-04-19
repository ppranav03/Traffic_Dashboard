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
import Select from 'react-select';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function EdgeLogsBarChart({ dimensions, selectedGraph, expandedCollection }) {
  const [edgeData, setEdgeData] = useState([]);
  const [dropdownData, setDropDownData] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [vehicleLogs, setVehicleLogs] = useState([]);
  const [currentSecond, setCurrentSecond] = useState(0);
  const [minSec, setMinSec] = useState(0);
  const [maxSec, setMaxSec] = useState(0);

  useEffect(() => {
    const fetchEdgeData = async () => {
      if (!expandedCollection) return;
      const token = sessionStorage.getItem('token');

      try {
        const vehicleResponse = await axios.get(
          `${process.env.REACT_APP_API_URL}:${process.env.REACT_APP_API_BACKEND_PORT}/api/file-vehicle-dropdown`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: { sim: expandedCollection },
          }
        );
        console.log('Fetched Distinct Vehicle IDs:', vehicleResponse.data);
        setDropDownData(vehicleResponse.data || []);
      } catch (error) {
        console.error('Error fetching dropdown data:', error);
      }

      try {
        const edgeResponse = await axios.get(
          `${process.env.REACT_APP_API_URL}:${process.env.REACT_APP_API_BACKEND_PORT}/api/file-edgeprobes`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: { sim: expandedCollection },
          }
        );
        console.log('Fetched file 16 data:', edgeResponse.data);
        setEdgeData(edgeResponse.data || []);
      } catch (error) {
        console.error('Error fetching edge data:', error);
      }
    };

    fetchEdgeData();
  }, [expandedCollection]);

  useEffect(() => {
    if (selectedVehicle && edgeData?.data?.length > 0) {
      const filtered = edgeData.data.filter(obj => obj.vehicle_id === selectedVehicle);
      const times = filtered.map(obj => obj.simulation_time_sec);

      if (times.length > 0) {
        const min = Math.min(...times);
        const max = Math.max(...times);

        setVehicleLogs(filtered);
        setMinSec(min);
        setMaxSec(max);
        setCurrentSecond(min); // reset to first second on new selection
      } else {
        setVehicleLogs([]);
        setMinSec(0);
        setMaxSec(0);
        setCurrentSecond(0);
      }
    }
  }, [selectedVehicle, edgeData]);

  const currentData = vehicleLogs.filter(
    row => Math.floor(row.simulation_time_sec) === currentSecond
  );

  const vehicleOptions =
    dropdownData?.data?.map((item) => ({
      value: item.vehicle_id,
      label: item.vehicle_id.toString(),
    })) || [];

  return (
    <div style={{ width: dimensions.graphWidth, height: dimensions.graphHeight, padding: '1rem' }}>
      <h3>Top 20 Edges by Number of Logs</h3>

      <Select
        options={vehicleOptions}
        onChange={(selectedOption) => {
          console.log('Selected Vehicle ID:', selectedOption.value);
          setSelectedVehicle(selectedOption.value);
        }}
        placeholder="Search vehicle ID..."
        isSearchable
        styles={{
          container: (provided) => ({
            ...provided,
            marginBottom: '10px',
            width: '300px',
          }),
        }}
      />

      {selectedVehicle && (
        <>
          <h4>Vehicle ID: {selectedVehicle}</h4>

          <input
            type="range"
            min={minSec}
            max={maxSec}
            value={currentSecond}
            onChange={(e) => setCurrentSecond(parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
          <p>
            Showing data for simulation second: <strong>{currentSecond}</strong>
          </p>

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
                <tr>
                  <td colSpan="6">No data for this second</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default EdgeLogsBarChart;
