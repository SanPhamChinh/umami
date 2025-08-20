import FilterLink from '@/components/common/FilterLink';
import { useMessages } from '@/components/hooks';
import MetricsTable, { MetricsTableProps } from './MetricsTable';

export function IpAddressTable(props: MetricsTableProps) {
  const { formatMessage, labels } = useMessages();

  const renderLink = ({ x: ip }) => {
    return (
      <FilterLink id="ip" value={ip} label={ip}>
        <span style={{ fontFamily: 'monospace' }}>{ip}</span>
      </FilterLink>
    );
  };

  return (
    <MetricsTable
      {...props}
      title={formatMessage(labels.ipAddress)}
      type="ip"
      metric={formatMessage(labels.visitors)}
      renderLabel={renderLink}
      searchFormattedValues={false}
    />
  );
}

export default IpAddressTable;