import React from 'react';
import {createObject, Renderer, RendererEnv, RendererProps} from 'amis-core';
import {Api, Payload} from 'amis-core';
import {
  BaseSchema,
  SchemaApi,
  SchemaTokenizeableString,
  SchemaTpl,
  SchemaCollection
} from '../Schema';
import {withStore} from 'amis-ui';
import {flow, Instance, types} from 'mobx-state-tree';
import {getPropValue, guid, isObject} from 'amis-core';
import {StoreNode} from 'amis-core';
import {isPureVariable, resolveVariableAndFilter} from 'amis-core';
import {
  isApiOutdated,
  isEffectiveApi,
  normalizeApi,
  normalizeApiResponseData
} from 'amis-core';
/**
 * Mapping 映射展示控件。
 * 文档：https://baidu.gitee.io/amis/docs/components/mapping
 */
export interface MappingSchema extends BaseSchema {
  /**
   * 指定为映射展示控件
   */
  type: 'map' | 'mapping';

  /**
   * 关联字段名。
   */
  name?: string;

  /**
   * 配置映射规则，值可以使用模板语法。当 key 为 * 时表示 else，也就是说值没有映射到任何规则时用 * 对应的值展示。
   */
  map?: {
    [propName: string]: SchemaTpl;
  };

  /**
   * map或source为对象数组时，作为value值的字段名
   */
  valueField?: string;

  /**
   * map或source为对象数组时，作为label值的字段名
   */
  labelField?: string;

  /**
   * 自定义渲染映射值，支持html或schema
   */
  itemSchema?: SchemaCollection;

  /**
   * 如果想远程拉取字典，请配置 source 为接口。
   */
  source?: SchemaApi | SchemaTokenizeableString;

  /**
   * 占位符
   */
  placeholder?: string;
}

export const Store = StoreNode.named('MappingStore')
  .props({
    fetching: false,
    errorMsg: '',
    valueField: 'value',
    map: types.frozen<{
      [propName: string]: any;
    }>({})
  })
  .actions(self => {
    const load: (env: RendererEnv, api: Api, data: any) => Promise<any> = flow(
      function* (env, api, data) {
        try {
          self.fetching = true;
          const ret: Payload = yield env.fetcher(api, data);

          if (ret.ok) {
            const data = normalizeApiResponseData(ret.data);
            (self as any).setMap(data);
          } else {
            throw new Error(ret.msg || 'fetch error');
          }
        } catch (e) {
          self.errorMsg = e.message;
        } finally {
          self.fetching = false;
        }
      }
    );

    return {
      load,
      setMap(options: any) {
        if (Array.isArray(options)) {
          options = options.reduce((res, now) => {
            if (now == null) {
              return res;
            } else if (isObject(now)) {
              let keys = Object.keys(now);
              if (
                keys.length === 1
                || (keys.length == 2 && keys.includes('$$id'))
              ) {
                // 针对amis-editor的特殊处理
                keys = keys.filter(key => key !== '$$id');
                // 单key 数组对象
                res[keys[0]] = now[keys[0]];
              }
              else if (keys.length > 1) {
                // 多key 数组对象
                res[now[self.valueField]] = now;
              }
            }
            return res;
          }, {});
        }
        if (isObject(options)) {
          self.map = {
            ...options
          };
        }
      }
    };
  });

export type IStore = Instance<typeof Store>;

export interface MappingProps
  extends Omit<RendererProps, 'store'>,
    Omit<MappingSchema, 'type' | 'className'> {
  store: IStore;
}

export const MappingField = withStore(props =>
  Store.create(
    {
      id: guid(),
      storeType: Store.name
    },
    props.env
  )
)(
  class extends React.Component<MappingProps, object> {
    static defaultProps: Partial<MappingProps> = {
      placeholder: '-',
      map: {
        '*': '通配值'
      }
    };

    constructor(props: MappingProps) {
      super(props);
      props.store.syncProps(props, undefined, ['valueField', 'map']);
    }

    componentDidMount() {
      this.reload();
    }

    componentDidUpdate(prevProps: MappingProps) {
      const props = this.props;
      const {store, source, data} = this.props;
      store.syncProps(props, prevProps, ['valueField', 'map']);

      if (isPureVariable(source)) {
        const prev = resolveVariableAndFilter(
          prevProps.source as string,
          prevProps.data,
          '| raw'
        );
        const curr = resolveVariableAndFilter(source as string, data, '| raw');

        if (prev !== curr) {
          store.setMap(curr);
        }
      } else if (
        isApiOutdated(
          prevProps.source,
          props.source,
          prevProps.data,
          props.data
        )
      ) {
        this.reload();
      }
    }

    reload() {
      const {source, data, env} = this.props;
      const store = this.props.store;
      if (isPureVariable(source)) {
        store.setMap(resolveVariableAndFilter(source, data, '| raw'));
      } else if (isEffectiveApi(source, data)) {
        const api = normalizeApi(source, 'get');
        api.cache = api.cache ?? 30 * 1000;
        store.load(env, api, data);
      }
    }

    renderSingleValue(key: any, reactKey?: number, needStyle?: boolean) {
      const {
        className,
        style,
        placeholder,
        classnames: cx,
        store
      } = this.props;
      let viewValue: React.ReactNode = (
        <span className="text-muted">{placeholder}</span>
      );
      const map = store.map;

      let value: any = undefined;
      // trim 一下，干掉一些空白字符。
      key = typeof key === 'string' ? key.trim() : key;
      const curStyle = needStyle ? style : undefined;
      if (
        typeof key !== 'undefined' &&
        map &&
        (value =
          map[key] ??
          (key === true && map['1']
            ? map['1']
            : key === false && map['0']
            ? map['0']
            : map['*'])) !== undefined
      ) {
        viewValue = this.renderViewValue(value);
      }

      return (
        <span key={`map-${reactKey}`} className={cx('MappingField', className)} style={curStyle}>
          {viewValue}
        </span>
      );
    }

    renderViewValue(value: any) {
      const {
        render,
        itemSchema,
        data,
        labelField
      } = this.props;

      if (!itemSchema) {
        let label = value;
        if (isObject(value)) {
          if (labelField === undefined || labelField === '') {
            if (!value.hasOwnProperty('type')) {
              // 映射值是object
              // 没配置labelField
              // object 也没有 type，不能作为schema渲染
              // 默认取 label 字段
              label = value['label'];
            }
          } else {
            label = value[labelField || 'label'];
          }
        }
        return render('tpl', label);
      }

      return render('mappingItemSchema', itemSchema, {
        data: createObject(
          data,
          isObject(value) ? value : {item: value}
        )
      });
    }

    render() {
      const {style} = this.props;
      const mapKey = getPropValue(this.props);
      if (Array.isArray(mapKey)) {
        return (
          <span style={style}>
            {mapKey.map((singleKey: string, index: number) =>
              this.renderSingleValue(singleKey, index)
            )}
          </span>
        );
      } else {
        return this.renderSingleValue(mapKey, 0, true);
      }
    }
  }
);

@Renderer({
  test: /(^|\/)(?:map|mapping)$/,
  name: 'mapping'
})
export class MappingFieldRenderer extends React.Component<RendererProps> {
  render() {
    return <MappingField {...this.props} />;
  }
}
