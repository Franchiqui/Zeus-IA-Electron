'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  Globe,
  Key,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Shield,
  Terminal,
  Trash2,
  XCircle,
  Plus,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { format } from 'date-fns';

interface ApiEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  status: 'active' | 'deprecated' | 'beta';
  latency: number;
  lastCalled: string;
  callsToday: number;
  errorsToday: number;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
  permissions: string[];
  active: boolean;
}

interface ApiLog {
  id: string;
  timestamp: string;
  endpoint: string;
  method: string;
  status: number;
  duration: number;
  ip: string;
  userAgent: string;
}

interface ApiMetrics {
  totalEndpoints: number;
  activeEndpoints: number;
  totalCallsToday: number;
  totalErrorsToday: number;
  averageLatency: number;
  uptime: number;
}

const chartData = [
  { date: '2024-01-09', success: 1200, error: 10, latency: 45 },
  { date: '2024-01-10', success: 1300, error: 8, latency: 50 },
  { date: '2024-01-11', success: 1100, error: 12, latency: 48 },
  { date: '2024-01-12', success: 1400, error: 15, latency: 52 },
  { date: '2024-01-13', success: 1250, error: 9, latency: 47 },
  { date: '2024-01-14', success: 1350, error: 11, latency: 49 },
  { date: '2024-01-15', success: 1450, error: 13, latency: 51 },
];

export default function ApiDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [metrics, setMetrics] = useState<ApiMetrics | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const mockEndpoints: ApiEndpoint[] = [
        {
          id: '1',
          method: 'GET',
          path: '/api/v1/users',
          description: 'Retrieve all users',
          status: 'active',
          latency: 45,
          lastCalled: '2024-01-15T10:30:00Z',
          callsToday: 1234,
          errorsToday: 2,
        },
        {
          id: '2',
          method: 'POST',
          path: '/api/v1/users',
          description: 'Create a new user',
          status: 'active',
          latency: 120,
          lastCalled: '2024-01-15T10:25:00Z',
          callsToday: 567,
          errorsToday: 5,
        },
        {
          id: '3',
          method: 'GET',
          path: '/api/v1/products',
          description: 'List all products',
          status: 'active',
          latency: 30,
          lastCalled: '2024-01-15T10:28:00Z',
          callsToday: 2890,
          errorsToday: 1,
        },
        {
          id: '4',
          method: 'PUT',
          path: '/api/v1/products/:id',
          description: 'Update product details',
          status: 'beta',
          latency: 85,
          lastCalled: '2024-01-15T09:15:00Z',
          callsToday: 123,
          errorsToday: 8,
        },
        {
          id: '5',
          method: 'DELETE',
          path: '/api/v1/products/:id',
          description: 'Delete a product',
          status: 'deprecated',
          latency: 60,
          lastCalled: '2024-01-14T16:45:00Z',
          callsToday: 45,
          errorsToday: 3,
        },
      ];

      const mockApiKeys: ApiKey[] = [
        {
          id: '1',
          name: 'Production Key',
          key: 'sk_prod_••••••••••••••••',
          created: '2023-06-01',
          lastUsed: '2024-01-15T10:30:00Z',
          permissions: ['read', 'write', 'delete'],
          active: true,
        },
        {
          id: '2',
          name: 'Development Key',
          key: 'sk_dev_••••••••••••••••••',
          created: '2023-12-15',
          lastUsed: '2024-01-15T09:45:00Z',
          permissions: ['read', 'write'],
          active: true,
        },
        {
          id: '3',
          name: 'Staging Key',
          key: 'sk_stag_••••••••••••••••',
          created: '2024-01-01',
          lastUsed: '2024-01-14T14:20:00Z',
          permissions: ['read'],
          active: false,
        },
      ];

      const mockLogs: ApiLog[] = Array.from({ length: 20 }, (_, i) => ({
        id: `log-${i}`,
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
        endpoint: ['/api/v1/users', '/api/v1/products', '/api/v1/orders'][Math.floor(Math.random() * 3)],
        method: ['GET', 'POST', 'PUT', 'DELETE'][Math.floor(Math.random() * 4)],
        status: [200, 201, 400, 401, 404, 500][Math.floor(Math.random() * 6)],
        duration: Math.floor(Math.random() * 500) + 10,
        ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Mozilla/5.0...',
      }));

      const mockMetrics: ApiMetrics = {
        totalEndpoints: 25,
        activeEndpoints: 22,
        totalCallsToday: 4859,
        totalErrorsToday: 19,
        averageLatency: 68,
        uptime: 99.97,
      };

      setEndpoints(mockEndpoints);
      setApiKeys(mockApiKeys);
      setLogs(mockLogs);
      setMetrics(mockMetrics);
      setIsLoading(false);
    } catch (error) {
      toast({
        title: 'Error fetching API data',
        description: 'Please try again later.',
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchData();
    setIsRefreshing(false);
    toast({
      title: 'Dashboard refreshed',
      description: 'API data has been updated.',
    });
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 3000);
    toast({
      title: 'API key copied',
      description: 'The key has been copied to your clipboard.',
    });
  };

  const handleDeleteKey = (keyId: string) => {
    setApiKeys(prev => prev.filter(k => k.id !== keyId));
    toast({
      title: 'API key deleted',
      description: 'The key has been permanently removed.',
      variant: 'destructive',
    });
  };

  const handleEndpointClick = (endpoint: ApiEndpoint) => {
    toast({
      title: 'Endpoint selected',
      description: `Viewing details for ${endpoint.path}`,
    });
  };

  const handleGenerateKey = () => {
    const newKey: ApiKey = {
      id: `key-${Date.now()}`,
      name: 'New Key',
      key: `sk_${Math.random().toString(36).substr(2, 9)}`,
      created: new Date().toISOString(),
      lastUsed: '',
      permissions: ['read'],
      active: true,
    };
    setApiKeys(prev => [...prev, newKey]);
    toast({
      title: 'API key generated',
      description: 'New API key has been created.',
    });
  };

  const handleRevokeKey = (keyId: string) => {
    setApiKeys(prev => prev.map(k => k.id === keyId ? { ...k, active: false } : k));
    toast({
      title: 'API key revoked',
      description: 'The key has been deactivated.',
      variant: 'destructive',
    });
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      POST: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      PUT: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
      DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      PATCH: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100',
    };
    return colors[method] || 'bg-gray-100 text-gray-800';
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-600';
    if (status >= 400 && status < 500) return 'text-yellow-600';
    if (status >= 500) return 'text-red-600';
    return 'text-gray-600';
  };

  const filteredEndpoints = endpoints.filter(ep =>
    ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ep.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLogs = logs.filter(log =>
    log.endpoint.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.method.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor and manage your API endpoints, keys, and usage.
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Endpoints</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.totalEndpoints}</div>
              <p className="text-xs text-muted-foreground">
                {metrics.activeEndpoints} active
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today&apos;s Calls</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.totalCallsToday.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {metrics.totalErrorsToday} errors
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.averageLatency}ms</div>
              <p className="text-xs text-muted-foreground">Last 24 hours</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Uptime</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.uptime}%</div>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">
            <Globe className="mr-2 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="endpoints">
            <Terminal className="mr-2 h-4 w-4" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="keys">
            <Key className="mr-2 h-4 w-4" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="logs">
            <FileJson className="mr-2 h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Request Volume (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="success" fill="hsl(var(--chart-1))" name="Success" />
                      <Bar dataKey="error" fill="hsl(var(--chart-2))" name="Error" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Latency Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="latency" stroke="hsl(var(--chart-3))" name="Avg Latency (ms)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Endpoints Tab */}
        <TabsContent value="endpoints" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search endpoints..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
                <SelectItem value="deprecated">Deprecated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Calls (24h)</TableHead>
                  <TableHead>Avg Latency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEndpoints.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No endpoints found matching your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEndpoints.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell>
                        <Badge
                          variant={
                            endpoint.method === 'GET' ? 'default' :
                            endpoint.method === 'POST' ? 'secondary' :
                            endpoint.method === 'PUT' ? 'outline' : 'destructive'
                          }
                        >
                          {endpoint.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{endpoint.path}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{endpoint.description}</TableCell>
                      <TableCell>{endpoint.callsToday.toLocaleString()}</TableCell>
                      <TableCell>{endpoint.latency}ms</TableCell>
                      <TableCell>
                        <Badge variant={endpoint.status === 'active' ? 'default' : endpoint.status === 'beta' ? 'secondary' : 'outline'}>
                          {endpoint.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleEndpointClick(endpoint)}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent value="keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">API Keys</h3>
            <Button onClick={handleGenerateKey}>
              <Plus className="mr-2 h-4 w-4" />
              Generate New Key
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No API keys generated yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell className="font-mono text-sm">
                        <code>{key.key.substring(0, 8)}...{key.key.substring(key.key.length - 4)}</code>
                      </TableCell>
                      <TableCell>{format(new Date(key.created), 'MMM d, yyyy')}</TableCell>
                      <TableCell>{key.lastUsed ? format(new Date(key.lastUsed), 'MMM d, yyyy HH:mm') : 'Never'}</TableCell>
                      <TableCell>
                        <Badge variant={key.active ? 'default' : 'destructive'}>
                          {key.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleCopyKey(key.key)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevokeKey(key.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No logs found matching your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}</TableCell>
                      <TableCell>
                        <Badge variant={log.method === 'GET' ? 'default' : 'secondary'}>
                          {log.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{log.endpoint}</TableCell>
                      <TableCell>
                        <Badge variant={log.status < 400 ? 'default' : 'destructive'}>
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.duration}ms</TableCell>
                      <TableCell className="font-mono text-sm">{log.ip}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Toast for copy feedback */}
      {copiedKey && (
        <div className="fixed bottom-4 right-4">
          <div className="bg-primary text-primary-foreground px-4 py-2 rounded-md shadow-lg">
            API key copied to clipboard!
          </div>
        </div>
      )}
    </div>
  );
}
