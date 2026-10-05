export type CloudProvider = 'aws' | 'azure';
export function cloudProvider(): CloudProvider {
  const value = process.env.CLOUD_PROVIDER ?? 'aws';
  if (value !== 'aws' && value !== 'azure') throw new Error('Invalid cloud provider');
  return value;
}
