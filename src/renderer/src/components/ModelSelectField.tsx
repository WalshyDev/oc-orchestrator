import { recordRecentModel, useRecentModels } from '../hooks/useRecentModels'
import { SelectField, type SelectFieldProps } from './SelectField'

export function ModelSelectField(props: Omit<SelectFieldProps, 'recentValues'>) {
  const recentModels = useRecentModels()
  return (
    <SelectField
      {...props}
      recentValues={recentModels}
      onChange={(value) => {
        recordRecentModel(value)
        props.onChange(value)
      }}
    />
  )
}
