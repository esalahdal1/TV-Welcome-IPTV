package com.example.tv_guest_welcome.iptv.ui

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.tv_guest_welcome.R
import com.example.tv_guest_welcome.iptv.Channel
import com.example.tv_guest_welcome.iptv.ImageLoader
import kotlinx.coroutines.CoroutineScope

class ChannelAdapter(
    private val scope: CoroutineScope,
    private val imageLoader: ImageLoader,
    private val itemWidthDp: Int? = null,
    private val onClick: (Channel, Int) -> Unit
) : RecyclerView.Adapter<ChannelAdapter.VH>() {
    private val items = ArrayList<Channel>()

    fun submit(channels: List<Channel>) {
        items.clear()
        items.addAll(channels)
        notifyDataSetChanged()
    }

    fun getChannels(): List<Channel> = items.toList()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_channel, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.name.text = item.name
        imageLoader.load(scope, item.logoUrl, holder.logo, android.R.drawable.ic_media_play)
        val lp = holder.root.layoutParams
        if (lp != null) {
            lp.width = itemWidthDp?.let { dp ->
                (dp * holder.root.resources.displayMetrics.density).toInt().coerceAtLeast(1)
            } ?: ViewGroup.LayoutParams.MATCH_PARENT
            holder.root.layoutParams = lp
        }
        holder.root.setOnClickListener { onClick(item, position) }

        val density = holder.root.resources.displayMetrics.density
        val radius = 16f * density
        val stroke = (2f * density).toInt().coerceAtLeast(1)

        val focusedBg = holder.focusedBg ?: GradientDrawable().apply {
            cornerRadius = radius
            setColor(Color.parseColor("#22FFFFFF"))
            setStroke(stroke, Color.parseColor("#FBBF24"))
        }.also { holder.focusedBg = it }

        val normalBg = holder.normalBg ?: GradientDrawable().apply {
            cornerRadius = radius
            setColor(Color.parseColor("#00000000"))
            setStroke(1, Color.parseColor("#00000000"))
        }.also { holder.normalBg = it }

        fun applyFocusState(hasFocus: Boolean) {
            holder.root.background = if (hasFocus) focusedBg else normalBg
            holder.root.animate().scaleX(if (hasFocus) 1.06f else 1f).scaleY(if (hasFocus) 1.06f else 1f).setDuration(90).start()
        }

        holder.root.onFocusChangeListener = View.OnFocusChangeListener { _, hasFocus ->
            applyFocusState(hasFocus)
        }
        applyFocusState(holder.root.isFocused)
    }

    override fun getItemCount(): Int = items.size

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val root: View = view
        val logo: ImageView = view.findViewById(R.id.channel_logo)
        val name: TextView = view.findViewById(R.id.channel_name)
        var focusedBg: GradientDrawable? = null
        var normalBg: GradientDrawable? = null
    }
}
