import React, { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Area,
  AreaChart
} from "recharts";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Separator } from "./components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog";
import {
  Car,
  Gauge,
  Fuel,
  Thermometer,
  MapPin,
  AlertTriangle,
  Plus,
  Download,
  Activity,
  Settings,
  Monitor
} from "lucide-react";
import "./App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Dashboard Component
const Dashboard = () => {
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [telemetryData, setTelemetryData] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [historicalData, setHistoricalData] = useState([]);
  const wsRef = useRef(null);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket(`${WS_URL}/ws/telemetry`);
      
      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
      };
      
      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'telemetry_update') {
          // Update telemetry data
          const newTelemetryData = {};
          message.data.forEach(data => {
            newTelemetryData[data.vehicle_id] = data;
          });
          setTelemetryData(newTelemetryData);
          
          // Update alerts
          setAlerts(message.alerts || []);
          
          // Update historical data for charts
          setHistoricalData(prev => {
            const newData = [...prev];
            message.data.forEach(data => {
              newData.push({
                ...data,
                time: new Date(data.timestamp).toLocaleTimeString()
              });
            });
            // Keep only last 50 data points for performance
            return newData.slice(-50);
          });
        }
      };
      
      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Fetch vehicles
  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const response = await axios.get(`${API}/vehicles`);
        setVehicles(response.data);
        if (response.data.length > 0 && !selectedVehicle) {
          setSelectedVehicle(response.data[0]);
        }
      } catch (error) {
        console.error('Error fetching vehicles:', error);
      }
    };

    fetchVehicles();
  }, []);

  const currentTelemetry = selectedVehicle ? telemetryData[selectedVehicle.id] : null;
  const vehicleAlerts = alerts.filter(alert => 
    selectedVehicle ? alert.vehicle_id === selectedVehicle.id : true
  );

  const chartData = historicalData
    .filter(data => selectedVehicle ? data.vehicle_id === selectedVehicle.id : true)
    .map(data => ({
      time: data.time,
      speed: data.speed,
      rpm: data.engine_rpm / 100, // Scale down for better visualization
      fuel: data.fuel_level,
      temperature: data.engine_temperature
    }));

  const getAlertColor = (severity) => {
    switch (severity) {
      case 'high': return 'destructive';
      case 'medium': return 'warning';
      default: return 'secondary';
    }
  };

  const exportTelemetry = async () => {
    if (!selectedVehicle) return;
    
    try {
      const response = await axios.get(
        `${API}/vehicles/${selectedVehicle.id}/telemetry/export`,
        { responseType: 'blob' }
      );
      
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `telemetry_${selectedVehicle.name}_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting telemetry:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Car className="h-8 w-8 text-blue-600" />
                <h1 className="text-2xl font-bold text-gray-900">Car Telemetry</h1>
              </div>
              <Badge variant={isConnected ? "default" : "destructive"} className="ml-4">
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            
            <div className="flex items-center space-x-4">
              <Select value={selectedVehicle?.id || ""} onValueChange={(value) => {
                const vehicle = vehicles.find(v => v.id === value);
                setSelectedVehicle(vehicle);
              }}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select Vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map(vehicle => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.name} ({vehicle.license_plate})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Link to="/manage">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Alerts Section */}
        {vehicleAlerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {vehicleAlerts.slice(0, 3).map((alert, index) => (
              <Alert key={index} className="border-l-4 border-l-red-500">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="font-medium">
                  {alert.message}
                  <Badge variant={getAlertColor(alert.severity)} className="ml-2">
                    {alert.severity}
                  </Badge>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Current Metrics Cards */}
        {currentTelemetry && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Speed</CardTitle>
                <Gauge className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{currentTelemetry.speed}</div>
                <p className="text-xs text-muted-foreground">km/h</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Engine RPM</CardTitle>
                <Activity className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{currentTelemetry.engine_rpm}</div>
                <p className="text-xs text-muted-foreground">RPM</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Fuel Level</CardTitle>
                <Fuel className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{currentTelemetry.fuel_level}%</div>
                <p className="text-xs text-muted-foreground">Fuel remaining</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Temperature</CardTitle>
                <Thermometer className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{currentTelemetry.engine_temperature}°C</div>
                <p className="text-xs text-muted-foreground">Engine temp</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Speed & RPM</CardTitle>
              <CardDescription>Real-time speed and engine RPM monitoring</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="speed" stroke="#2563eb" name="Speed (km/h)" />
                  <Line type="monotone" dataKey="rpm" stroke="#16a34a" name="RPM (x100)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fuel & Temperature</CardTitle>
              <CardDescription>Fuel level and engine temperature trends</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="fuel" stackId="1" stroke="#eab308" fill="#fef3c7" name="Fuel %" />
                  <Area type="monotone" dataKey="temperature" stackId="2" stroke="#dc2626" fill="#fee2e2" name="Temperature °C" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex justify-center">
          <Button onClick={exportTelemetry} disabled={!selectedVehicle}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV Data
          </Button>
        </div>
      </main>
    </div>
  );
};

// Vehicle Management Component
const VehicleManagement = () => {
  const [vehicles, setVehicles] = useState([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    name: "",
    model: "",
    year: new Date().getFullYear(),
    license_plate: ""
  });
  const navigate = useNavigate();

  useEffect(() => {
    fetchVehicles();
  }, []);

  const fetchVehicles = async () => {
    try {
      const response = await axios.get(`${API}/vehicles`);
      setVehicles(response.data);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
    }
  };

  const handleAddVehicle = async () => {
    try {
      await axios.post(`${API}/vehicles`, newVehicle);
      setNewVehicle({ name: "", model: "", year: new Date().getFullYear(), license_plate: "" });
      setIsAddDialogOpen(false);
      fetchVehicles();
    } catch (error) {
      console.error('Error adding vehicle:', error);
    }
  };

  const handleDeleteVehicle = async (vehicleId) => {
    try {
      await axios.delete(`${API}/vehicles/${vehicleId}`);
      fetchVehicles();
    } catch (error) {
      console.error('Error deleting vehicle:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" onClick={() => navigate('/')}>
                <Car className="h-6 w-6 mr-2" />
                Back to Dashboard
              </Button>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Vehicle Management</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Fleet Vehicles</h2>
          
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Vehicle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Vehicle</DialogTitle>
                <DialogDescription>
                  Add a new vehicle to your telemetry fleet.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Vehicle Name</Label>
                  <Input
                    id="name"
                    value={newVehicle.name}
                    onChange={(e) => setNewVehicle({...newVehicle, name: e.target.value})}
                    placeholder="e.g., Fleet Car 1"
                  />
                </div>
                <div>
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    value={newVehicle.model}
                    onChange={(e) => setNewVehicle({...newVehicle, model: e.target.value})}
                    placeholder="e.g., Toyota Camry"
                  />
                </div>
                <div>
                  <Label htmlFor="year">Year</Label>
                  <Input
                    id="year"
                    type="number"
                    value={newVehicle.year}
                    onChange={(e) => setNewVehicle({...newVehicle, year: parseInt(e.target.value)})}
                  />
                </div>
                <div>
                  <Label htmlFor="license_plate">License Plate</Label>
                  <Input
                    id="license_plate"
                    value={newVehicle.license_plate}
                    onChange={(e) => setNewVehicle({...newVehicle, license_plate: e.target.value.toUpperCase()})}
                    placeholder="e.g., ABC123"
                  />
                </div>
                <Button onClick={handleAddVehicle} className="w-full">
                  Add Vehicle
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {vehicles.map(vehicle => (
            <Card key={vehicle.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {vehicle.name}
                  <Badge variant="outline">{vehicle.license_plate}</Badge>
                </CardTitle>
                <CardDescription>
                  {vehicle.model} ({vehicle.year})
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Added {new Date(vehicle.created_at).toLocaleDateString()}
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteVehicle(vehicle.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

// Main App Component
function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/manage" element={<VehicleManagement />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;