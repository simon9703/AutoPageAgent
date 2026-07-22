export interface WithdrawalDetail {
  estimatedArrivalTime: string;
}

export async function getWithdrawalDetail(): Promise<WithdrawalDetail> {
  return fetch("/api/v2/withdrawal/detail").then((response) => response.json());
}

export function ArrivalTime(props: WithdrawalDetail) {
  return <span data-field="estimatedArrivalTime">{props.estimatedArrivalTime}</span>;
}
